import Dexie, { type EntityTable } from 'dexie';
import type {
  ConsentRecord,
  DailySummary,
  LogEntry,
  PhotoMeta,
  Project,
  Site,
  TimeEntry,
  User,
  WorkOrder,
} from '../core/models/domain.models';

export interface MockUser extends User {
  readonly username: string;
  /** Demo backend only. A real server never stores plain passwords. */
  readonly password: string;
  /** Missing means active (older demo rows). */
  readonly active?: boolean;
  /** Projects a manager leads. */
  readonly projectIds?: readonly string[];
  /** Objects a foreman leads. */
  readonly siteIds?: readonly string[];
}
/** Projects and objects carry an archive flag on the demo server only (the shared domain types stay lean). */
export type Archivable = { readonly active?: boolean };
/** Server-side order row: `crewIds` is a multi-entry index so "orders for worker X" stays a lookup. */
export interface MockOrder extends WorkOrder {
  readonly crewIds: readonly string[];
}
export interface MockPhoto extends PhotoMeta {
  readonly blob: Blob | null;
}
export interface MockIdempotency {
  readonly key: string;
  readonly at: number;
}
export interface MockMeta {
  readonly key: string;
  readonly value: string;
}

/**
 * Simulated server storage. A separate IndexedDB database from the device store, so purging device data
 * after sync is observable: the manager view keeps reading from here.
 */
export class MockServerDb extends Dexie {
  users!: EntityTable<MockUser, 'id'>;
  projects!: EntityTable<Project, 'id'>;
  sites!: EntityTable<Site, 'id'>;
  orders!: EntityTable<MockOrder, 'id'>;
  timeEntries!: EntityTable<TimeEntry, 'id'>;
  logs!: EntityTable<LogEntry, 'id'>;
  photos!: EntityTable<MockPhoto, 'id'>;
  summaries!: EntityTable<DailySummary, 'id'>;
  consents!: EntityTable<ConsentRecord & { readonly key: string }, 'key'>;
  idempotency!: EntityTable<MockIdempotency, 'key'>;
  meta!: EntityTable<MockMeta, 'key'>;

  constructor() {
    super('aon-mock-server');
    this.version(1).stores({
      users: 'id, &username, role',
      sites: 'id',
      orders: 'id, assigneeId, siteId, status',
      timeEntries: 'id, userId, date, workOrderId, [userId+date]',
      logs: 'id, workOrderId, userId, createdAt',
      photos: 'id, workOrderId, userId',
      summaries: 'id, userId, date',
      consents: 'key, userId',
      idempotency: 'key',
      meta: 'key',
    });
    // v2: projects and crews. The seed rewrites every table on its version bump.
    this.version(2).stores({
      projects: 'id',
      orders: 'id, *crewIds, siteId, status',
      photos: 'id, workOrderId, userId, createdAt',
      meta: 'key',
    });
  }
}
