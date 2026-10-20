import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { SessionStore } from '../../../core/auth/session.store';
import type { LocalLogEntry, LocalPhoto, LocalSummary, LocalTimeEntry, LocalWorkOrder } from '../../../core/db/aon-db';
import { DatabaseService } from '../../../core/db/database.service';
import { liveSignal } from '../../../core/db/live';
import { ApiClient } from '../../../core/http/api-client.service';
import type {
  EpochMs,
  LogEntry,
  Material,
  PhotoCategory,
  PhotoMeta,
  ReportOrderLine,
  Site,
  TimeCorrection,
  TimeEntry,
  WorkOrderStatus,
} from '../../../core/models/domain.models';
import { NetworkStatusService } from '../../../core/network/network-status.service';
import { SyncEngine } from '../../../core/sync/sync-engine.service';
import { entityKeys, queueItem } from '../../../core/sync/sync-queue';
import { ClockService } from '../../../core/ui/clock.service';
import { compareCodes, minutesBetween, toIsoDate, uuid } from '../../../core/util/util';

/** Planned shift length used for the day-capacity bar. */
export const SHIFT_CAPACITY_MINUTES = 8 * 60;

const STATUS_ORDER: Readonly<Record<WorkOrderStatus, number>> = { IN_PROGRESS: 0, ISSUE: 1, NEW: 2, COMPLETED: 3 };

const ALLOWED: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  NEW: ['IN_PROGRESS', 'ISSUE'],
  IN_PROGRESS: ['COMPLETED', 'ISSUE'],
  ISSUE: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: [],
};

export class WorkflowError extends Error {
  constructor(
    readonly code:
      | 'NO_SESSION'
      | 'NO_SHIFT'
      | 'SHIFT_OPEN'
      | 'STALE_SHIFT'
      | 'NOT_FOUND'
      | 'INVALID_TRANSITION'
      | 'INVALID_INPUT'
      | 'INVALID_TIME'
      | 'REPORT_LOCKED'
      | 'DAY_CLOSED'
      | 'NO_SITE'
      | 'STORAGE_FULL',
  ) {
    super(code);
    this.name = 'WorkflowError';
  }
}

/** What the worker types into the daily report. Kept on the device until submitted. */
export interface ReportDraft {
  readonly workDone: Readonly<Record<string, string>>;
  readonly materials: Readonly<Record<string, readonly Material[]>>;
  readonly comment: string;
  readonly corrections: readonly TimeCorrection[];
}

const EMPTY_DRAFT: ReportDraft = { workDone: {}, materials: {}, comment: '', corrections: [] };

/** An object the worker can choose at ZAČNI DELO. `assigned`: one of their open orders runs there. */
export interface SiteOption {
  readonly id: string;
  readonly label: string;
  readonly city: string;
  readonly assigned: boolean;
}

/**
 * The worker's device-side state and every field action.
 * Each action is ONE Dexie transaction: the local change and its sync op commit together or not at all,
 * so an entry can never be shown as saved yet be missing from the upload queue.
 */
@Injectable({ providedIn: 'root' })
export class WorkerStore {
  private readonly db = inject(DatabaseService).db;
  private readonly api = inject(ApiClient);
  private readonly sync = inject(SyncEngine);
  private readonly network = inject(NetworkStatusService);
  private readonly session = inject(SessionStore);
  private readonly clock = inject(ClockService);

  private readonly uid = computed(() => this.session.user()?.id ?? null);
  readonly today = computed(() => toIsoDate(this.clock.now()));
  private readonly userDay = computed(() => ({ uid: this.uid(), date: this.today() }), {
    equal: (a, b) => a.uid === b.uid && a.date === b.date,
  });

  readonly refreshing = signal(false);
  readonly refreshFailed = signal(false);

  readonly orders = liveSignal(
    this.uid,
    async (uid): Promise<readonly LocalWorkOrder[]> => {
      if (!uid) return [];
      const list = await this.db.workOrders.where('ownerId').equals(uid).toArray();
      return list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || compareCodes(a.code, b.code));
    },
    [] as readonly LocalWorkOrder[],
  );

  /** Today's entries plus any entry still open from an earlier day (a shift someone forgot to end). */
  readonly dayEntries = liveSignal(
    this.userDay,
    async ({ uid, date }): Promise<readonly LocalTimeEntry[]> => {
      if (!uid) return [];
      const all = await this.db.timeEntries.where('userId').equals(uid).toArray();
      return all.filter((e) => e.date === date || e.endedAt === null).sort((a, b) => a.startedAt - b.startedAt);
    },
    [] as readonly LocalTimeEntry[],
  );

  readonly todayLogs = liveSignal(
    this.userDay,
    async ({ uid, date }): Promise<readonly LocalLogEntry[]> => {
      if (!uid) return [];
      const start = new Date(`${date}T00:00:00`).getTime();
      const logs = await this.db.logs.where('userId').equals(uid).toArray();
      return logs.filter((l) => l.createdAt >= start).sort((a, b) => a.createdAt - b.createdAt);
    },
    [] as readonly LocalLogEntry[],
  );

  /** Every photo still on this device for the worker, newest first. Binaries are gone once uploaded. */
  readonly photos = liveSignal(
    this.uid,
    async (uid): Promise<readonly LocalPhoto[]> => {
      if (!uid) return [];
      const photos = await this.db.photos.where('userId').equals(uid).toArray();
      return photos.sort((a, b) => b.createdAt - a.createdAt);
    },
    [] as readonly LocalPhoto[],
  );
  readonly todayPhotos = computed(() => {
    const start = new Date(`${this.today()}T00:00:00`).getTime();
    return this.photos().filter((p) => p.createdAt >= start);
  });

  readonly summary = liveSignal(
    this.userDay,
    async ({ uid, date }): Promise<LocalSummary | null> => (uid ? ((await this.db.summaries.get(summaryId(uid, date))) ?? null) : null),
    null as LocalSummary | null,
  );

  private readonly storedDraft = liveSignal(
    this.userDay,
    async ({ uid, date }): Promise<ReportDraft | null> => {
      if (!uid) return null;
      const row = await this.db.kv.get(draftKey(uid, date));
      return isDraft(row?.value) ? row.value : null;
    },
    null as ReportDraft | null,
  );

  /** Cached so a shift can start on a site without signal. */
  private readonly sites = liveSignal(
    this.uid,
    async (uid): Promise<readonly Site[]> => {
      if (!uid) return [];
      const value = (await this.db.kv.get(sitesKey(uid)))?.value;
      return Array.isArray(value) ? (value as Site[]) : [];
    },
    [] as readonly Site[],
  );

  /** Objects of the worker's open orders first, then every other active object. */
  readonly siteOptions = computed<readonly SiteOption[]>(() => {
    const out = new Map<string, SiteOption>();
    const byId = new Map(this.sites().map((s) => [s.id, s]));
    for (const o of this.orders()) {
      if (o.status === 'COMPLETED' || !o.siteId || out.has(o.siteId)) continue;
      out.set(o.siteId, { id: o.siteId, label: o.siteName || o.location, city: byId.get(o.siteId)?.city ?? '', assigned: true });
    }
    for (const s of this.sites()) {
      if (!out.has(s.id)) out.set(s.id, { id: s.id, label: `${s.projectName} · ${s.name}`, city: s.city, assigned: false });
    }
    return [...out.values()];
  });

  readonly openShift = computed(() => this.dayEntries().find((e) => e.kind === 'SHIFT' && e.endedAt === null) ?? null);
  /** A shift left running from an earlier day. Its real end has to be declared, not tapped now. */
  readonly staleShift = computed(() => {
    const s = this.openShift();
    return s && s.date < this.today() ? s : null;
  });
  readonly activeSegment = computed(() => this.dayEntries().find((e) => e.kind === 'ORDER' && e.endedAt === null) ?? null);
  readonly activeOrder = computed(() => {
    const seg = this.activeSegment();
    return seg ? (this.orders().find((o) => o.id === seg.workOrderId) ?? null) : null;
  });
  readonly lastEndedShift = computed(() => {
    const shifts = this.dayEntries().filter((e) => e.kind === 'SHIFT' && e.endedAt !== null && e.date === this.today());
    return shifts.at(-1) ?? null;
  });
  private readonly todayShifts = computed(() => this.dayEntries().filter((e) => e.kind === 'SHIFT' && e.date === this.today()));

  readonly shiftMinutes = computed(() =>
    this.todayShifts().reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? this.clock.now()), 0),
  );
  readonly orderMinutes = computed(() =>
    this.dayEntries()
      .filter((e) => e.kind === 'ORDER' && e.date === this.today())
      .reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? this.clock.now()), 0),
  );

  // ---------- daily report ----------

  readonly arrivalAt = computed<EpochMs | null>(() => this.todayShifts()[0]?.startedAt ?? null);
  readonly departureAt = computed<EpochMs | null>(() => {
    const shifts = this.todayShifts();
    if (shifts.length === 0 || shifts.some((s) => s.endedAt === null)) return null;
    return Math.max(...shifts.map((s) => s.endedAt ?? 0));
  });
  readonly declaredEnd = computed(() => this.todayShifts().some((s) => s.endSource === 'DECLARED'));

  /** "Projekt · Objekt" of the object chosen for the running (or last) shift. */
  readonly shiftSiteName = computed(() => this.siteLabel((this.openShift() ?? this.todayShifts().at(-1))?.siteId ?? null));
  /** Every object chosen today, in order, for the daily report. */
  readonly daySiteNames = computed(() => {
    const ids = [...new Set(this.todayShifts().map((s) => s.siteId).filter((id): id is string => !!id))];
    return ids.map((id) => this.siteLabel(id)).filter((l): l is string => !!l).join(', ') || null;
  });

  /** Open while the worker chooses an object for ZAČNI DELO. */
  readonly sitePickerOpen = signal(false);
  private pickResolve: ((siteId: string | null | undefined) => void) | null = null;

  /** Resolves `undefined` when the worker cancels, `null` when no object exists yet. */
  chooseSite(): Promise<string | null | undefined> {
    const options = this.siteOptions();
    if (options.length === 0) return Promise.resolve(null);
    if (options.length === 1) return Promise.resolve(options[0]?.id ?? null);
    this.pickResolve?.(undefined);
    this.sitePickerOpen.set(true);
    return new Promise((resolve) => (this.pickResolve = resolve));
  }

  resolveSite(siteId: string | undefined): void {
    this.sitePickerOpen.set(false);
    const resolve = this.pickResolve;
    this.pickResolve = null;
    resolve?.(siteId);
  }

  private siteLabel(siteId: string | null): string | null {
    if (!siteId) return null;
    return this.siteOptions().find((o) => o.id === siteId)?.label ?? null;
  }

  /** Report lines assembled from today's records. Text fields carry the worker's notes as a starting point. */
  readonly reportLines = computed<readonly ReportOrderLine[]>(() => {
    const today = this.today();
    const now = this.clock.now();
    const ids: string[] = [];
    const add = (id: string | null): void => {
      if (id && !ids.includes(id)) ids.push(id);
    };
    for (const e of this.dayEntries()) if (e.kind === 'ORDER' && e.date === today) add(e.workOrderId);
    for (const l of this.todayLogs()) add(l.workOrderId);
    for (const p of this.todayPhotos()) add(p.workOrderId);
    return ids.map((id) => {
      const order = this.orders().find((o) => o.id === id);
      const logs = this.todayLogs().filter((l) => l.workOrderId === id);
      return {
        workOrderId: id,
        code: order?.code ?? null,
        title: order?.title ?? '',
        siteName: order?.siteName ?? '',
        minutes: this.dayEntries()
          .filter((e) => e.kind === 'ORDER' && e.workOrderId === id && e.date === today)
          .reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? now), 0),
        quantity: Math.round(logs.filter((l) => l.kind === 'QUANTITY').reduce((s, l) => s + (l.quantity ?? 0), 0) * 100) / 100,
        unit: order?.unit ?? 'PCS',
        workDone: logs
          .filter((l) => l.kind === 'NOTE')
          .map((l) => l.text ?? '')
          .join('\n'),
        materialsUsed: (order?.materials ?? []).map((m) => ({ name: m.name, qty: null, unit: m.unit })),
        issues: logs.filter((l) => l.kind === 'ISSUE').map((l) => l.text ?? ''),
        photoCount: this.todayPhotos().filter((p) => p.workOrderId === id).length,
      };
    });
  });

  /** The draft the form edits: the worker's saved text, else a returned report's text, else empty. */
  readonly draft = computed<ReportDraft>(() => {
    const stored = this.storedDraft();
    if (stored) return stored;
    const s = this.summary();
    if (s && s.status === 'RETURNED') {
      return {
        workDone: Object.fromEntries(s.lines.map((l) => [l.workOrderId, l.workDone])),
        materials: Object.fromEntries(s.lines.map((l) => [l.workOrderId, l.materialsUsed])),
        comment: s.comment,
        corrections: s.corrections,
      };
    }
    return EMPTY_DRAFT;
  });

  constructor() {
    this.sync.onDrained(() => this.refreshFromServer());
    this.network.reconnected$.subscribe(() => void this.refreshFromServer());
    // New or changed orders from the office show up while the app is open, not only at the next start.
    const refresh = (): void => {
      if (document.visibilityState === 'visible') void this.refreshFromServer();
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
  }

  minutesOnOrder(orderId: string): number {
    const now = this.clock.now();
    return this.dayEntries()
      .filter((e) => e.kind === 'ORDER' && e.workOrderId === orderId)
      .reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? now), 0);
  }

  canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
    return ALLOWED[from].includes(to);
  }

  // ---------- shift ----------

  /** ZAČNI DELO on the chosen object: records the worker, the object, the date and the time of arrival. */
  async startShift(siteId: string | null): Promise<TimeEntry> {
    const uid = this.requireUid();
    if (this.staleShift()) throw new WorkflowError('STALE_SHIFT');
    if (this.dayClosed()) throw new WorkflowError('DAY_CLOSED');
    const existing = this.openShift();
    if (existing) return existing;
    if (siteId === null && this.siteOptions().length > 0) throw new WorkflowError('NO_SITE');
    const now = Date.now();
    const entry: LocalTimeEntry = {
      id: uuid(),
      userId: uid,
      kind: 'SHIFT',
      workOrderId: null,
      siteId,
      date: toIsoDate(now),
      startedAt: now,
      endedAt: null,
      synced: 0,
    };
    await this.db.transaction('rw', [this.db.timeEntries, this.db.syncQueue], async () => {
      await this.db.timeEntries.add(entry);
      await this.db.syncQueue.add(queueItem(uid, entityKeys.timeEntry(entry.id), { type: 'TIME_ENTRY_UPSERT', payload: stripLocal(entry) }));
    });
    this.sync.nudge();
    return entry;
  }

  /** Ends the shift (and any running order segment). Returns the total shift minutes today. */
  async endShift(): Promise<number> {
    const uid = this.requireUid();
    const shift = this.openShift();
    if (!shift) throw new WorkflowError('NO_SHIFT');
    if (this.staleShift()) throw new WorkflowError('STALE_SHIFT');
    const now = Date.now();
    const segment = this.activeSegment();
    await this.db.transaction('rw', [this.db.timeEntries, this.db.syncQueue], async () => {
      if (segment) await this.closeEntry(uid, segment, now);
      await this.closeEntry(uid, shift, now);
    });
    this.sync.nudge();
    return this.shiftMinutes();
  }

  /**
   * Closes a shift the worker forgot to end, at the time they state. Recorded as DECLARED with the
   * reason, so the manager sees it was not tapped live. Never moves a start, never shortens a tapped end.
   */
  async declareShiftEnd(endAt: EpochMs, reason: string): Promise<void> {
    const uid = this.requireUid();
    const shift = this.staleShift();
    if (!shift) throw new WorkflowError('NO_SHIFT');
    const note = reason.trim();
    if (!note) throw new WorkflowError('INVALID_INPUT');
    if (!Number.isFinite(endAt) || endAt <= shift.startedAt || endAt > Date.now()) throw new WorkflowError('INVALID_TIME');
    const segment = this.activeSegment();
    await this.db.transaction('rw', [this.db.timeEntries, this.db.syncQueue], async () => {
      if (segment) await this.closeEntry(uid, segment, Math.max(segment.startedAt, Math.min(endAt, Date.now())), 'DECLARED', note);
      await this.closeEntry(uid, shift, endAt, 'DECLARED', note);
    });
    this.sync.nudge();
  }

  // ---------- work orders ----------

  async startOrder(orderId: string): Promise<void> {
    const uid = this.requireUid();
    if (this.dayClosed()) throw new WorkflowError('DAY_CLOSED');
    if (!this.openShift()) throw new WorkflowError('NO_SHIFT');
    if (this.staleShift()) throw new WorkflowError('STALE_SHIFT');
    const order = this.findOrder(orderId);
    if (order.status !== 'IN_PROGRESS' && !this.canTransition(order.status, 'IN_PROGRESS')) {
      throw new WorkflowError('INVALID_TRANSITION');
    }
    const current = this.activeSegment();
    if (current?.workOrderId === orderId) return;
    const now = Date.now();
    const segment: LocalTimeEntry = {
      id: uuid(),
      userId: uid,
      kind: 'ORDER',
      workOrderId: orderId,
      date: toIsoDate(now),
      startedAt: now,
      endedAt: null,
      synced: 0,
    };
    await this.db.transaction('rw', [this.db.timeEntries, this.db.workOrders, this.db.syncQueue], async () => {
      if (current) await this.closeEntry(uid, current, now);
      await this.db.timeEntries.add(segment);
      await this.db.syncQueue.add(queueItem(uid, entityKeys.timeEntry(segment.id), { type: 'TIME_ENTRY_UPSERT', payload: stripLocal(segment) }));
      if (order.status !== 'IN_PROGRESS') await this.setStatus(uid, order, 'IN_PROGRESS', now);
    });
    this.sync.nudge();
  }

  /** Stops only this worker's timer. Crewmates' timers are theirs to stop. */
  async pauseOrder(): Promise<void> {
    const uid = this.requireUid();
    const segment = this.activeSegment();
    if (!segment) return;
    await this.db.transaction('rw', [this.db.timeEntries, this.db.syncQueue], () => this.closeEntry(uid, segment, Date.now()));
    this.sync.nudge();
  }

  /** Any crew member may finish the order for the whole crew; it stops only their own timer. */
  async finishOrder(orderId: string): Promise<void> {
    const uid = this.requireUid();
    if (this.dayClosed()) throw new WorkflowError('DAY_CLOSED');
    const order = this.findOrder(orderId);
    if (!this.canTransition(order.status, 'COMPLETED')) throw new WorkflowError('INVALID_TRANSITION');
    const now = Date.now();
    const segment = this.activeSegment();
    await this.db.transaction('rw', [this.db.timeEntries, this.db.workOrders, this.db.syncQueue], async () => {
      if (segment?.workOrderId === orderId) await this.closeEntry(uid, segment, now);
      await this.setStatus(uid, order, 'COMPLETED', now);
    });
    this.sync.nudge();
  }

  async addQuantity(orderId: string, quantity: number): Promise<void> {
    const uid = this.requireUid();
    if (this.dayClosed()) throw new WorkflowError('DAY_CLOSED');
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) throw new WorkflowError('INVALID_INPUT');
    const order = this.findOrder(orderId);
    const q = Math.round(quantity * 100) / 100;
    const log = this.newLog(uid, orderId, 'QUANTITY', q, null);
    await this.db.transaction('rw', [this.db.logs, this.db.workOrders, this.db.syncQueue], async () => {
      await this.db.logs.add(log);
      await this.db.workOrders.update(orderId, { doneQty: Math.round((order.doneQty + q) * 100) / 100, dirty: 1, updatedAt: log.createdAt });
      await this.db.syncQueue.add(queueItem(uid, entityKeys.order(orderId), { type: 'LOG_CREATE', payload: stripLocal(log) }));
    });
    this.sync.nudge();
  }

  /**
   * Takes back a quantity logged by mistake. The wrong entry stays in the history; the correction is a
   * negative entry with the reason, as on a site where nothing in the books is erased.
   */
  async correctQuantity(orderId: string, amount: number, reason: string): Promise<void> {
    const uid = this.requireUid();
    if (this.dayClosed()) throw new WorkflowError('DAY_CLOSED');
    const order = this.findOrder(orderId);
    const q = Math.round(amount * 100) / 100;
    const why = reason.trim();
    if (!Number.isFinite(q) || q <= 0 || q > order.doneQty || !why) throw new WorkflowError('INVALID_INPUT');
    const log = this.newLog(uid, orderId, 'QUANTITY', -q, why.slice(0, 500));
    await this.db.transaction('rw', [this.db.logs, this.db.workOrders, this.db.syncQueue], async () => {
      await this.db.logs.add(log);
      await this.db.workOrders.update(orderId, { doneQty: Math.round((order.doneQty - q) * 100) / 100, dirty: 1, updatedAt: log.createdAt });
      await this.db.syncQueue.add(queueItem(uid, entityKeys.order(orderId), { type: 'LOG_CREATE', payload: stripLocal(log) }));
    });
    this.sync.nudge();
  }

  async addNote(orderId: string, text: string): Promise<void> {
    const uid = this.requireUid();
    const clean = text.trim();
    if (!clean) throw new WorkflowError('INVALID_INPUT');
    this.findOrder(orderId);
    const log = this.newLog(uid, orderId, 'NOTE', null, clean.slice(0, 2000));
    await this.db.transaction('rw', [this.db.logs, this.db.syncQueue], async () => {
      await this.db.logs.add(log);
      await this.db.syncQueue.add(queueItem(uid, entityKeys.log(log.id), { type: 'LOG_CREATE', payload: stripLocal(log) }));
    });
    this.sync.nudge();
  }

  /** Logs the issue, flags the order PROBLEM and stops this worker's timer on it. */
  async reportIssue(orderId: string, text: string): Promise<void> {
    const uid = this.requireUid();
    const clean = text.trim();
    if (!clean) throw new WorkflowError('INVALID_INPUT');
    const order = this.findOrder(orderId);
    if (order.status === 'COMPLETED') throw new WorkflowError('INVALID_TRANSITION');
    const now = Date.now();
    const log = this.newLog(uid, orderId, 'ISSUE', null, clean.slice(0, 2000));
    const segment = this.activeSegment();
    await this.db.transaction('rw', [this.db.logs, this.db.timeEntries, this.db.workOrders, this.db.syncQueue], async () => {
      await this.db.logs.add(log);
      await this.db.syncQueue.add(queueItem(uid, entityKeys.log(log.id), { type: 'LOG_CREATE', payload: stripLocal(log) }));
      if (segment?.workOrderId === orderId) await this.closeEntry(uid, segment, now);
      if (order.status !== 'ISSUE') await this.setStatus(uid, order, 'ISSUE', now);
    });
    this.sync.nudge();
  }

  // ---------- photos ----------

  async savePhoto(input: {
    readonly orderId: string;
    readonly category: PhotoCategory;
    readonly caption: string;
    readonly blob: Blob;
    readonly thumb: Blob;
    readonly width: number;
    readonly height: number;
    readonly maskCount: number;
  }): Promise<void> {
    const uid = this.requireUid();
    const order = this.findOrder(input.orderId);
    const meta: PhotoMeta = {
      id: uuid(),
      userId: uid,
      workOrderId: order.id,
      projectId: order.projectId,
      category: input.category,
      caption: input.caption.trim().slice(0, 280) || null,
      width: input.width,
      height: input.height,
      createdAt: Date.now(),
      privacyConfirmed: true,
      maskCount: input.maskCount,
    };
    try {
      await this.db.transaction('rw', [this.db.photos, this.db.syncQueue], async () => {
        await this.db.photos.add({ ...meta, blob: input.blob, thumb: input.thumb, synced: 0 });
        await this.db.syncQueue.add(queueItem(uid, entityKeys.photo(meta.id), { type: 'PHOTO_UPLOAD', payload: meta }));
      });
    } catch (err: unknown) {
      if (isQuotaError(err)) throw new WorkflowError('STORAGE_FULL');
      throw err;
    }
    this.sync.nudge();
  }

  /** A photo can be withdrawn only while it is still on the device and not uploaded. */
  async deletePhoto(photoId: string): Promise<void> {
    const uid = this.requireUid();
    await this.db.transaction('rw', [this.db.photos, this.db.syncQueue], async () => {
      const photo = await this.db.photos.get(photoId);
      if (!photo || photo.userId !== uid || photo.synced === 1) throw new WorkflowError('INVALID_TRANSITION');
      await this.db.syncQueue.where('entityKey').equals(entityKeys.photo(photoId)).delete();
      await this.db.photos.delete(photoId);
    });
  }

  // ---------- daily report ----------

  readonly reportEditable = computed(() => {
    const s = this.summary();
    return !s || s.status === 'DRAFT' || s.status === 'RETURNED';
  });
  /**
   * Today's report is with the manager (submitted or approved): the day is closed. No new time or quantity
   * is recorded, or it would be missing from the report the manager signs. Returning the report reopens it.
   */
  readonly dayClosed = computed(() => !this.reportEditable());

  async saveDraft(draft: ReportDraft): Promise<void> {
    const uid = this.requireUid();
    if (!this.reportEditable()) throw new WorkflowError('REPORT_LOCKED');
    await this.db.kv.put({ key: draftKey(uid, this.today()), value: draft });
  }

  /** `draft` is the form's current text, which may be newer than what the device store has caught up to. */
  async submitReport(draft: ReportDraft = this.draft()): Promise<void> {
    const uid = this.requireUid();
    if (this.openShift()) throw new WorkflowError('SHIFT_OPEN');
    if (!this.reportEditable()) throw new WorkflowError('REPORT_LOCKED');
    const date = this.today();
    const lines = this.reportLines().map((l) => ({
      ...l,
      workDone: (draft.workDone[l.workOrderId] ?? l.workDone).trim().slice(0, 4000),
      materialsUsed: (draft.materials[l.workOrderId] ?? l.materialsUsed).filter((m) => m.name.trim() !== ''),
    }));
    const summary: LocalSummary = {
      id: summaryId(uid, date),
      userId: uid,
      date,
      arrivalAt: this.arrivalAt(),
      departureAt: this.departureAt(),
      siteName: this.daySiteNames(),
      shiftMinutes: this.shiftMinutes(),
      orderMinutes: this.orderMinutes(),
      lines,
      ordersWorked: lines.flatMap((l) => (l.code ? [l.code] : [])).sort(),
      issuesReported: lines.reduce((n, l) => n + l.issues.length, 0),
      photosTaken: this.todayPhotos().length,
      declaredEnd: this.declaredEnd(),
      corrections: draft.corrections,
      comment: draft.comment.trim().slice(0, 2000),
      status: 'SUBMITTED',
      submittedAt: Date.now(),
      reviewedAt: null,
      reviewerName: null,
      reviewerNote: null,
      synced: 0,
    };
    const start = new Date(`${date}T00:00:00`).getTime();
    await this.db.transaction('rw', [this.db.summaries, this.db.syncQueue, this.db.kv, this.db.photos], async () => {
      await this.db.summaries.put(summary);
      await this.db.syncQueue.add(queueItem(uid, entityKeys.summary(summary.id), { type: 'SUMMARY_UPSERT', payload: stripLocal(summary) }));
      await this.db.kv.delete(draftKey(uid, date));
      // Data minimisation: previews of photos the server already holds are not needed once the day is reported.
      await this.db.photos
        .where('userId')
        .equals(uid)
        .and((p) => p.synced === 1 && p.createdAt >= start)
        .modify({ thumb: null });
    });
    this.sync.nudge();
  }

  // ---------- server refresh ----------

  /** Pull assigned orders and today's summary review. Local unsynced changes always win. */
  async refreshFromServer(): Promise<void> {
    const uid = this.uid();
    if (!uid || !this.network.online() || this.refreshing()) return;
    this.refreshing.set(true);
    try {
      const res = await this.api.workerOrders();
      if (res.sites) await this.db.kv.put({ key: sitesKey(uid), value: res.sites });
      await this.db.transaction('rw', [this.db.workOrders], async () => {
        const local = await this.db.workOrders.where('ownerId').equals(uid).toArray();
        const dirty = new Set(local.filter((o) => o.dirty === 1).map((o) => o.id));
        const incoming = new Set(res.orders.map((o) => o.id));
        await this.db.workOrders.bulkPut(res.orders.filter((o) => !dirty.has(o.id)).map((o) => ({ ...o, ownerId: uid, dirty: 0 as const })));
        const stale = local.filter((o) => !incoming.has(o.id) && o.dirty === 0).map((o) => o.id);
        if (stale.length) await this.db.workOrders.bulkDelete(stale);
      });
      const date = this.today();
      const remote = await this.api.workerSummary(date);
      if (remote) {
        const local = await this.db.summaries.get(remote.id);
        if (!local || local.synced === 1) await this.db.summaries.put({ ...remote, synced: 1 });
      }
      // Today's records from the worker's other devices (or from before the app's storage was cleared).
      // Anything this device has not sent yet stays as it is.
      const day = await this.api.workerDay(date, new Date(`${date}T00:00:00`).getTime());
      await this.db.transaction('rw', [this.db.timeEntries, this.db.logs], async () => {
        const entries = new Map((await this.db.timeEntries.where('userId').equals(uid).toArray()).map((e) => [e.id, e.synced]));
        await this.db.timeEntries.bulkPut(day.timeEntries.filter((e) => entries.get(e.id) !== 0).map((e) => ({ ...e, synced: 1 as const })));
        const logs = new Map((await this.db.logs.where('userId').equals(uid).toArray()).map((l) => [l.id, l.synced]));
        await this.db.logs.bulkPut(day.logs.filter((l) => logs.get(l.id) !== 0).map((l) => ({ ...l, synced: 1 as const })));
      });
      this.refreshFailed.set(false);
    } catch (err: unknown) {
      console.warn('[AON] order refresh failed', err);
      this.refreshFailed.set(true);
    } finally {
      this.refreshing.set(false);
    }
  }

  // ---------- internals ----------

  private requireUid(): string {
    const uid = this.uid();
    if (!uid) throw new WorkflowError('NO_SESSION');
    return uid;
  }

  private findOrder(orderId: string): LocalWorkOrder {
    const order = this.orders().find((o) => o.id === orderId);
    if (!order) throw new WorkflowError('NOT_FOUND');
    return order;
  }

  private newLog(uid: string, orderId: string, kind: LogEntry['kind'], quantity: number | null, text: string | null): LocalLogEntry {
    return { id: uuid(), userId: uid, workOrderId: orderId, kind, quantity, text, createdAt: Date.now(), synced: 0 };
  }

  /** Must run inside a transaction that includes timeEntries and syncQueue. */
  private async closeEntry(uid: string, entry: LocalTimeEntry, at: number, source: 'TAP' | 'DECLARED' = 'TAP', note: string | null = null): Promise<void> {
    const closed: LocalTimeEntry = {
      ...entry,
      endedAt: Math.max(at, entry.startedAt),
      endSource: source,
      endNote: note,
      synced: 0,
    };
    await this.db.timeEntries.put(closed);
    await this.db.syncQueue.add(queueItem(uid, entityKeys.timeEntry(closed.id), { type: 'TIME_ENTRY_UPSERT', payload: stripLocal(closed) }));
  }

  /** Must run inside a transaction that includes workOrders and syncQueue. */
  private async setStatus(uid: string, order: LocalWorkOrder, status: WorkOrderStatus, at: number): Promise<void> {
    await this.db.workOrders.update(order.id, { status, dirty: 1, updatedAt: at });
    await this.db.syncQueue.add(
      queueItem(uid, entityKeys.order(order.id), { type: 'ORDER_STATUS', payload: { workOrderId: order.id, status, changedAt: at } }),
    );
  }
}

function summaryId(uid: string, date: string): string {
  return `sum-${uid}-${date}`;
}

function sitesKey(uid: string): string {
  return `worker-sites:${uid}`;
}

function draftKey(uid: string, date: string): string {
  return `report-draft:${uid}:${date}`;
}

function isDraft(value: unknown): value is ReportDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ReportDraft>;
  return typeof v.comment === 'string' && typeof v.workDone === 'object' && typeof v.materials === 'object' && Array.isArray(v.corrections);
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string; inner?: { name?: string } } | null)?.name ?? '';
  const inner = (err as { inner?: { name?: string } } | null)?.inner?.name ?? '';
  return name === 'QuotaExceededError' || inner === 'QuotaExceededError';
}

/** Remove device-only fields before a record goes into a sync payload. */
function stripLocal<T extends { synced: unknown }>(record: T): Omit<T, 'synced'> {
  const { synced: _synced, ...rest } = record;
  return rest;
}
