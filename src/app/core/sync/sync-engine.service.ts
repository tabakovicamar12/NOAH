import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionStore } from '../auth/session.store';
import { DatabaseService } from '../db/database.service';
import { liveSignal } from '../db/live';
import { ApiClient } from '../http/api-client.service';
import { toApiError } from '../http/interceptors';
import { I18nService } from '../i18n/i18n.service';
import type { SyncPhase, SyncQueueItem } from '../models/sync.models';
import { NetworkStatusService } from '../network/network-status.service';
import { ToastService } from '../ui/toast.service';
import { assertNever, errorMessage, toIsoDate } from '../util/util';
import { MAX_TRANSIENT_ATTEMPTS, backoffMs } from './sync-queue';

type DrainListener = () => Promise<void> | void;

const PERIODIC_MS = 60_000;

/**
 * Offline-first sync engine.
 *
 * - Every user action is written to IndexedDB together with a queue item, in one transaction.
 * - The queue replays strictly FIFO (by auto-increment `seq`) whenever the app is online.
 * - Transient failures (network, timeout, 5xx) stop the run and back off exponentially: later ops may
 *   depend on the failed one, so the engine never skips ahead.
 * - Permanent failures (4xx) park the op as FAILED; only ops of the same entity are held behind it.
 * - On success the local record is marked synced and sensitive payloads (photo binaries) are purged.
 */
@Injectable({ providedIn: 'root' })
export class SyncEngine {
  private readonly db = inject(DatabaseService).db;
  private readonly api = inject(ApiClient);
  private readonly network = inject(NetworkStatusService);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  readonly phase = signal<SyncPhase>('IDLE');
  readonly lastSyncAt = signal<number | null>(null);

  private readonly userId = computed(() => this.session.user()?.id ?? null);

  /** Live view of this user's queue, FIFO order. */
  readonly queue = liveSignal(
    this.userId,
    async (uid): Promise<readonly SyncQueueItem[]> =>
      uid ? (await this.db.syncQueue.where('userId').equals(uid).sortBy('seq')) : [],
    [] as readonly SyncQueueItem[],
  );
  readonly pendingCount = computed(() => this.queue().filter((i) => i.state === 'PENDING').length);
  readonly failedItems = computed(() => this.queue().filter((i) => i.state === 'FAILED'));
  readonly unsyncedCount = computed(() => this.queue().length);

  private running = false;
  private rerunRequested = false;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly drainListeners = new Set<DrainListener>();
  private started = false;

  /** Wire triggers. Called once from app bootstrap after the database is open. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loadLastSync();

    this.network.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const n = this.unsyncedCount();
      if (n > 0) this.toast.show(this.i18n.t('net.backOnline', { n }));
      void this.run();
    });

    const periodic = setInterval(() => {
      if (this.pendingCount() > 0) void this.run();
    }, PERIODIC_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void this.run();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      clearInterval(periodic);
      document.removeEventListener('visibilitychange', onVisible);
      if (this.backoffTimer) clearTimeout(this.backoffTimer);
    });

    void this.run();
  }

  /** Register work to run after the queue fully drains (e.g. pull fresh server state, purge). */
  onDrained(listener: DrainListener): () => void {
    this.drainListeners.add(listener);
    return () => this.drainListeners.delete(listener);
  }

  /** Ask for a sync soon. Safe to call after every local write. */
  nudge(): void {
    queueMicrotask(() => void this.run());
  }

  async syncNow(): Promise<void> {
    await this.network.probe();
    await this.run();
  }

  async retry(seq: number): Promise<void> {
    try {
      await this.db.syncQueue.update(seq, { state: 'PENDING', attempts: 0, nextAttemptAt: 0, lastError: null });
      this.nudge();
    } catch (err: unknown) {
      console.error('[AON] retry failed', err);
    }
  }

  /** Discard a permanently failed op. The local record stays on the device, marked unsynced. */
  async discard(seq: number): Promise<void> {
    try {
      await this.db.syncQueue.delete(seq);
      this.nudge();
    } catch (err: unknown) {
      console.error('[AON] discard failed', err);
    }
  }

  async run(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    let processed = 0;
    try {
      processed = await this.drain();
    } catch (err: unknown) {
      console.error('[AON] sync run crashed', err);
      this.phase.set('ERROR');
    } finally {
      this.running = false;
    }
    if (processed > 0) {
      this.toast.success(this.i18n.t('net.syncDone', { n: processed }));
    }
    if (this.rerunRequested) {
      this.rerunRequested = false;
      void this.run();
    }
  }

  private async drain(): Promise<number> {
    let processed = 0;
    for (;;) {
      const uid = this.userId();
      if (!uid) {
        this.phase.set('IDLE');
        return processed;
      }
      if (!this.network.online() || this.session.expired()) {
        this.phase.set('WAITING_FOR_NETWORK');
        return processed;
      }

      const items = await this.db.syncQueue.where('userId').equals(uid).sortBy('seq');
      const next = this.pickNext(items);
      if (next === 'EMPTY') {
        this.phase.set('IDLE');
        if (processed > 0) await this.afterDrain();
        return processed;
      }
      if (next === 'BLOCKED') {
        this.phase.set(this.failedItems().length > 0 ? 'ERROR' : 'IDLE');
        if (processed > 0) await this.afterDrain();
        return processed;
      }
      if ('waitUntil' in next) {
        this.phase.set('BACKOFF');
        this.scheduleBackoff(next.waitUntil);
        return processed;
      }

      this.phase.set('SYNCING');
      const item = next.item;
      const seq = item.seq;
      if (seq === undefined) return processed;
      try {
        await this.execute(item);
        await this.db.syncQueue.delete(seq);
        await this.applySuccess(item);
        processed++;
      } catch (raw: unknown) {
        const err = toApiError(raw);
        const attempts = item.attempts + 1;
        if (err.kind === 'UNAUTHORIZED') {
          this.phase.set('WAITING_FOR_NETWORK');
          return processed;
        }
        if (err.transient && attempts < MAX_TRANSIENT_ATTEMPTS) {
          await this.db.syncQueue.update(seq, {
            attempts,
            lastError: err.message,
            nextAttemptAt: Date.now() + backoffMs(attempts),
          });
          if (err.kind === 'NETWORK' || err.kind === 'TIMEOUT') {
            this.phase.set('WAITING_FOR_NETWORK');
            return processed;
          }
          continue;
        }
        await this.db.syncQueue.update(seq, { attempts, state: 'FAILED', lastError: `${err.kind}: ${err.message}` });
        this.toast.error(`${this.i18n.t(`opType.${item.op.type}`)}: ${err.message}`);
      }
    }
  }

  private pickNext(items: readonly SyncQueueItem[]): 'EMPTY' | 'BLOCKED' | { item: SyncQueueItem } | { waitUntil: number } {
    if (items.length === 0) return 'EMPTY';
    const blocked = new Set<string>();
    const now = Date.now();
    for (const item of items) {
      if (item.state === 'FAILED') {
        blocked.add(item.entityKey);
        continue;
      }
      if (blocked.has(item.entityKey)) continue;
      if (item.nextAttemptAt > now) return { waitUntil: item.nextAttemptAt };
      return { item };
    }
    return 'BLOCKED';
  }

  private scheduleBackoff(at: number): void {
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void this.run();
    }, Math.max(500, at - Date.now()));
  }

  private async execute(item: SyncQueueItem): Promise<void> {
    const { op } = item;
    switch (op.type) {
      case 'CONSENT':
        return this.api.postConsent(op.payload, item.opId);
      case 'TIME_ENTRY_UPSERT':
        return this.api.upsertTimeEntry(op.payload, item.opId);
      case 'ORDER_STATUS': {
        const { workOrderId, ...body } = op.payload;
        return this.api.setOrderStatus(workOrderId, body, item.opId);
      }
      case 'LOG_CREATE':
        return this.api.createLog(op.payload, item.opId);
      case 'PHOTO_UPLOAD': {
        const photo = await this.db.photos.get(op.payload.id);
        if (!photo?.blob) throw new Error('Photo binary missing on device');
        return this.api.uploadPhoto(op.payload, photo.blob, item.opId);
      }
      case 'SUMMARY_UPSERT':
        return this.api.upsertSummary(op.payload, item.opId);
      case 'ORDER_UPSERT':
        return this.api.upsertOrder(op.payload, item.opId);
      default:
        return assertNever(op);
    }
  }

  /** Mark the local record synced once no further ops for its entity remain; purge sensitive data. */
  private async applySuccess(item: SyncQueueItem): Promise<void> {
    try {
      const remaining = await this.db.syncQueue.where('entityKey').equals(item.entityKey).count();
      const { op } = item;
      switch (op.type) {
        case 'CONSENT':
          return;
        case 'TIME_ENTRY_UPSERT':
          if (remaining === 0) await this.db.timeEntries.update(op.payload.id, { synced: 1 });
          return;
        case 'ORDER_STATUS':
          if (remaining === 0) await this.db.workOrders.update(op.payload.workOrderId, { dirty: 0 });
          return;
        case 'LOG_CREATE':
          await this.db.logs.update(op.payload.id, { synced: 1 });
          if (op.payload.kind === 'QUANTITY' && remaining === 0) {
            await this.db.workOrders.update(op.payload.workOrderId, { dirty: 0 });
          }
          return;
        case 'PHOTO_UPLOAD':
          // GDPR: the server has the image; remove the binary from the device immediately. The preview
          // stays only while the day's report is still open.
          await this.db.photos.update(op.payload.id, {
            blob: null,
            synced: 1,
            ...((await this.dayReported(op.payload.userId, op.payload.createdAt)) ? { thumb: null } : {}),
          });
          return;
        case 'SUMMARY_UPSERT':
          if (remaining === 0) await this.db.summaries.update(op.payload.id, { synced: 1 });
          return;
        case 'ORDER_UPSERT':
          // The server now holds the order (and its number); the local copy only existed to bridge the gap.
          if (remaining === 0) await this.db.authoredOrders.delete(op.payload.id);
          return;
        default:
          return assertNever(op);
      }
    } catch (err: unknown) {
      console.error('[AON] post-sync bookkeeping failed', errorMessage(err));
    }
  }

  private async dayReported(userId: string, at: number): Promise<boolean> {
    const summary = await this.db.summaries.get(`sum-${userId}-${toIsoDate(at)}`);
    return !!summary && summary.status !== 'DRAFT' && summary.status !== 'RETURNED';
  }

  private async afterDrain(): Promise<void> {
    const now = Date.now();
    this.lastSyncAt.set(now);
    try {
      await this.db.kv.put({ key: 'lastSyncAt', value: now });
    } catch {
      /* non-critical */
    }
    await this.purgeSynced();
    for (const listener of this.drainListeners) {
      try {
        await listener();
      } catch (err: unknown) {
        console.error('[AON] drain listener failed', err);
      }
    }
  }

  /**
   * Data minimisation: once the server holds them, entries from previous days are removed from the
   * device. Today's synced entries stay so the worker can still review and submit the daily summary.
   */
  async purgeSynced(): Promise<void> {
    const today = toIsoDate();
    const startOfToday = new Date(`${today}T00:00:00`).getTime();
    try {
      await this.db.transaction('rw', [this.db.timeEntries, this.db.logs, this.db.photos, this.db.summaries], async () => {
        await this.db.timeEntries.where('synced').equals(1).and((e) => e.date < today && e.endedAt !== null).delete();
        await this.db.logs.where('synced').equals(1).and((l) => l.createdAt < startOfToday).delete();
        await this.db.photos.where('synced').equals(1).and((p) => p.createdAt < startOfToday).delete();
        await this.db.summaries.where('synced').equals(1).and((s) => s.date < today).delete();
      });
    } catch (err: unknown) {
      console.error('[AON] purge failed', err);
    }
  }

  private async loadLastSync(): Promise<void> {
    try {
      const rec = await this.db.kv.get('lastSyncAt');
      if (typeof rec?.value === 'number') this.lastSyncAt.set(rec.value);
    } catch {
      /* ignore */
    }
  }
}
