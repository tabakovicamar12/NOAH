import { Injectable, computed, inject, signal } from '@angular/core';
import { SessionStore } from '../../../core/auth/session.store';
import type { LocalAuthoredOrder } from '../../../core/db/aon-db';
import { DatabaseService } from '../../../core/db/database.service';
import { liveSignal } from '../../../core/db/live';
import { ApiClient } from '../../../core/http/api-client.service';
import type {
  ManagerDirectoryResponse,
  ManagerOverviewResponse,
  ManagerProjectsResponse,
  ProjectCreate,
  SiteCreate,
  SummaryDetailResponse,
  SummaryReviewRequest,
  WorkOrderDetailResponse,
  WorkOrderUpsert,
} from '../../../core/models/api.models';
import { canApproveReports, isAdmin, type IsoDate, type Project, type Site } from '../../../core/models/domain.models';
import { NetworkStatusService } from '../../../core/network/network-status.service';
import { SyncEngine } from '../../../core/sync/sync-engine.service';
import { entityKeys, queueItem } from '../../../core/sync/sync-queue';
import { toIsoDate } from '../../../core/util/util';

interface CachedOverview {
  readonly savedAt: number;
  readonly data: ManagerOverviewResponse;
}

export type OverviewState = 'LOADING' | 'READY' | 'CACHED' | 'EMPTY_OFFLINE' | 'ERROR';
export type DirectoryState = 'LOADING' | 'READY' | 'CACHED' | 'UNAVAILABLE';

const cacheKey = (date: IsoDate): string => `mgr.overview:${date}`;
const DIRECTORY_KEY = 'mgr.directory';
const PROJECTS_KEY = 'mgr.projects';

/**
 * Manager read model plus the manager's own writes. The overview is fetched per day and the last good copy
 * is kept on the device, so a site cabin without signal still shows the day's picture, marked with its age.
 * Work orders written here go through the same offline queue the field uses.
 */
@Injectable({ providedIn: 'root' })
export class ManagerStore {
  private readonly api = inject(ApiClient);
  private readonly db = inject(DatabaseService).db;
  private readonly network = inject(NetworkStatusService);
  private readonly sync = inject(SyncEngine);
  private readonly session = inject(SessionStore);

  readonly date = signal<IsoDate>(toIsoDate());
  readonly overview = signal<ManagerOverviewResponse | null>(null);
  readonly savedAt = signal<number | null>(null);
  readonly state = signal<OverviewState>('LOADING');
  readonly isToday = computed(() => this.date() === toIsoDate());
  /** The header search: filters the orders and team tables wherever the manager types it. */
  readonly query = signal('');
  readonly role = computed(() => this.session.user()?.role ?? null);
  /** Administrator: accounts, projects, objects and who leads them. */
  readonly isAdmin = computed(() => isAdmin(this.role()));
  /** May approve or return daily reports (not a foreman). */
  readonly canApprove = computed(() => canApproveReports(this.role()));

  readonly directory = signal<ManagerDirectoryResponse | null>(null);
  readonly directoryState = signal<DirectoryState>('LOADING');

  private readonly uid = computed(() => this.session.user()?.id ?? null);

  /** Orders written on this device that the server has not confirmed yet. */
  readonly authored = liveSignal(
    this.uid,
    async (uid): Promise<readonly LocalAuthoredOrder[]> => (uid ? this.db.authoredOrders.where('ownerId').equals(uid).toArray() : []),
    [] as readonly LocalAuthoredOrder[],
  );

  /** Reports waiting for a decision on the selected day. */
  readonly toReview = computed(() =>
    (this.overview()?.summaries ?? []).filter((s) => s.status === 'SUBMITTED').sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)),
  );

  private loadSeq = 0;

  constructor() {
    this.network.reconnected$.subscribe(() => {
      void this.load();
      void this.loadDirectory();
    });
    this.sync.onDrained(() => this.load());
  }

  setDate(date: IsoDate): void {
    if (date === this.date()) return;
    this.date.set(date);
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.uid()) return;
    const seq = ++this.loadSeq;
    const date = this.date();
    if (!this.overview() || this.overview()?.date !== date) this.state.set('LOADING');
    try {
      if (!this.network.online()) throw new Error('offline');
      const data = await this.api.managerOverview(date);
      if (seq !== this.loadSeq) return;
      this.overview.set(data);
      this.savedAt.set(null);
      this.state.set('READY');
      await this.db.kv.put({ key: cacheKey(date), value: { savedAt: Date.now(), data } satisfies CachedOverview });
    } catch (err: unknown) {
      if (seq !== this.loadSeq) return;
      const cached = await this.readCache<CachedOverview>(cacheKey(date));
      if (cached && cached.data) {
        this.overview.set(cached.data);
        this.savedAt.set(cached.savedAt);
        this.state.set('CACHED');
      } else {
        this.overview.set(null);
        this.state.set(this.network.online() ? 'ERROR' : 'EMPTY_OFFLINE');
        if (this.network.online()) console.warn('[AON] overview load failed', err);
      }
    }
  }

  /** Projects, objects and workers for the order form. Cached for offline use. */
  async loadDirectory(): Promise<void> {
    if (!this.directory()) this.directoryState.set('LOADING');
    try {
      if (!this.network.online()) throw new Error('offline');
      const data = await this.api.managerDirectory();
      this.directory.set(data);
      this.directoryState.set('READY');
      await this.db.kv.put({ key: DIRECTORY_KEY, value: data });
    } catch {
      const cached = await this.readCache<ManagerDirectoryResponse>(DIRECTORY_KEY);
      if (cached && Array.isArray(cached.workers)) {
        this.directory.set(cached);
        this.directoryState.set('CACHED');
      } else if (!this.directory()) {
        this.directoryState.set('UNAVAILABLE');
      }
    }
  }

  /** Projects → objects → orders. Cached on the device like the overview. */
  async loadProjects(): Promise<{ data: ManagerProjectsResponse; cachedAt: number | null }> {
    try {
      if (!this.network.online()) throw new Error('offline');
      const data = await this.api.managerProjects();
      await this.db.kv.put({ key: PROJECTS_KEY, value: { savedAt: Date.now(), data } });
      return { data, cachedAt: null };
    } catch (err: unknown) {
      const cached = await this.readCache<{ savedAt: number; data: ManagerProjectsResponse }>(PROJECTS_KEY);
      if (cached?.data && Array.isArray(cached.data.projects)) return { data: cached.data, cachedAt: cached.savedAt };
      throw err;
    }
  }

  /**
   * New projects and objects go straight to the server (no offline queue): a code must be unique, and the
   * order form needs the object right away. The form's directory is refreshed so it shows up there too.
   */
  async createProject(body: ProjectCreate): Promise<Project> {
    const project = await this.api.createProject(body);
    void this.loadDirectory();
    return project;
  }

  async createSite(body: SiteCreate): Promise<Site> {
    const site = await this.api.createSite(body);
    void this.loadDirectory();
    return site;
  }

  detail(orderId: string): Promise<WorkOrderDetailResponse> {
    return this.api.workOrderDetail(orderId);
  }

  summaryDetail(id: string): Promise<SummaryDetailResponse> {
    return this.api.summaryDetail(id);
  }

  /** Writes the order to the device and queues it; the server issues its number on arrival. */
  async saveOrder(order: Omit<WorkOrderUpsert, 'savedAt'>): Promise<void> {
    const uid = this.uid();
    if (!uid) throw new Error('No session');
    const body: WorkOrderUpsert = { ...order, savedAt: Date.now() };
    await this.db.transaction('rw', [this.db.authoredOrders, this.db.syncQueue], async () => {
      await this.db.authoredOrders.put({ ...body, ownerId: uid, synced: 0 });
      await this.db.syncQueue.add(queueItem(uid, entityKeys.authored(body.id), { type: 'ORDER_UPSERT', payload: body }));
    });
    this.sync.nudge();
  }

  /** A review needs the server: it is the manager's signature on someone else's record. */
  async review(id: string, body: SummaryReviewRequest): Promise<void> {
    await this.api.reviewSummary(id, body);
    await this.load();
  }

  private async readCache<T>(key: string): Promise<T | null> {
    try {
      const row = await this.db.kv.get(key);
      const value = row?.value as (T & { savedAt?: unknown }) | undefined;
      return value ?? null;
    } catch {
      return null;
    }
  }
}
