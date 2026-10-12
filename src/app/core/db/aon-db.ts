import Dexie, { type EntityTable } from 'dexie';
import type { WorkOrderUpsert } from '../models/api.models';
import type {
  ConsentRecord,
  DailySummary,
  LogEntry,
  PhotoMeta,
  TimeEntry,
  User,
  WorkOrder,
} from '../models/domain.models';
import type { SyncQueueItem } from '../models/sync.models';

/** 0 = still only on this device, 1 = acknowledged by the server. Numeric so it can be indexed. */
export type SyncFlag = 0 | 1;

export interface LocalWorkOrder extends WorkOrder {
  readonly ownerId: string;
  /** Local changes not yet acknowledged; server refreshes never overwrite a dirty order. */
  readonly dirty: SyncFlag;
}
export interface LocalTimeEntry extends TimeEntry {
  readonly synced: SyncFlag;
}
export interface LocalLogEntry extends LogEntry {
  readonly synced: SyncFlag;
}
export interface LocalPhoto extends PhotoMeta {
  /** JPEG with privacy masks burned in and EXIF stripped. Purged after upload. */
  readonly blob: Blob | null;
  /** Small preview for the worker's own day. Purged once the daily report is submitted. */
  readonly thumb: Blob | null;
  readonly synced: SyncFlag;
}
export interface LocalSummary extends DailySummary {
  readonly synced: SyncFlag;
}
/** A work order a manager created or edited on this device, kept until the server confirms it. */
export interface LocalAuthoredOrder extends WorkOrderUpsert {
  readonly ownerId: string;
  readonly synced: SyncFlag;
}
export interface SessionRecord {
  readonly key: 'current';
  readonly user: User;
  readonly token: string;
  readonly expiresAt: number;
}
export interface KeyValue {
  readonly key: string;
  readonly value: unknown;
}

export class AonDatabase extends Dexie {
  session!: EntityTable<SessionRecord, 'key'>;
  consents!: EntityTable<ConsentRecord, 'userId'>;
  workOrders!: EntityTable<LocalWorkOrder, 'id'>;
  timeEntries!: EntityTable<LocalTimeEntry, 'id'>;
  logs!: EntityTable<LocalLogEntry, 'id'>;
  photos!: EntityTable<LocalPhoto, 'id'>;
  summaries!: EntityTable<LocalSummary, 'id'>;
  authoredOrders!: EntityTable<LocalAuthoredOrder, 'id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'seq'>;
  kv!: EntityTable<KeyValue, 'key'>;

  constructor(name = 'aon-device') {
    super(name);
    this.version(1).stores({
      session: 'key',
      consents: 'userId',
      workOrders: 'id, ownerId, status, [ownerId+status]',
      timeEntries: 'id, userId, date, [userId+date], kind, synced',
      logs: 'id, userId, workOrderId, createdAt, synced',
      photos: 'id, userId, workOrderId, createdAt, synced',
      summaries: 'id, userId, date, [userId+date], synced',
      syncQueue: '++seq, &opId, userId, entityKey, state',
      kv: 'key',
    });
    // v2: crews, projects, materials, photo thumbnails, structured daily reports, manager-authored orders.
    this.version(2)
      .stores({ authoredOrders: 'id, ownerId, synced' })
      .upgrade(async (tx) => {
        // Cached orders in the old single-assignee shape are re-downloaded; unsynced ones are kept.
        await tx.table('workOrders').filter((o: { dirty?: number; crew?: unknown }) => o.dirty !== 1 && !Array.isArray(o.crew)).delete();
        await tx.table('summaries').filter((s: { lines?: unknown }) => !Array.isArray(s.lines)).delete();
        await tx.table('photos').toCollection().modify((p: Record<string, unknown>) => {
          p['thumb'] ??= null;
          p['caption'] ??= null;
          p['projectId'] ??= '';
        });
      });
  }
}
