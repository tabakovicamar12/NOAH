import type {
  ConsentRequest,
  DailySummaryUpsert,
  LogEntryCreate,
  PhotoUploadMeta,
  TimeEntryUpsert,
  WorkOrderStatusRequest,
  WorkOrderUpsert,
} from './api.models';

/**
 * A queued, replayable server mutation. Ops are applied strictly FIFO by `seq`.
 * `entityKey` groups ops for one entity: a permanently failed op blocks later ops of the same entity
 * (so a FINISH never lands before its START), while unrelated entities keep syncing.
 */
export type SyncOperation =
  | { readonly type: 'CONSENT'; readonly payload: ConsentRequest }
  | { readonly type: 'TIME_ENTRY_UPSERT'; readonly payload: TimeEntryUpsert }
  | { readonly type: 'ORDER_STATUS'; readonly payload: WorkOrderStatusRequest & { readonly workOrderId: string } }
  | { readonly type: 'LOG_CREATE'; readonly payload: LogEntryCreate }
  | { readonly type: 'PHOTO_UPLOAD'; readonly payload: PhotoUploadMeta }
  | { readonly type: 'SUMMARY_UPSERT'; readonly payload: DailySummaryUpsert }
  | { readonly type: 'ORDER_UPSERT'; readonly payload: WorkOrderUpsert };

export type SyncOperationType = SyncOperation['type'];

export type SyncItemState = 'PENDING' | 'FAILED';

export interface SyncQueueItem {
  /** Auto-increment primary key: the FIFO order. */
  readonly seq?: number;
  readonly opId: string;
  readonly userId: string;
  readonly entityKey: string;
  readonly op: SyncOperation;
  readonly createdAt: number;
  readonly attempts: number;
  readonly state: SyncItemState;
  readonly lastError: string | null;
  readonly nextAttemptAt: number;
}

export type SyncPhase = 'IDLE' | 'SYNCING' | 'WAITING_FOR_NETWORK' | 'BACKOFF' | 'ERROR';
