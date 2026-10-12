import type { SyncOperation, SyncQueueItem } from '../models/sync.models';
import { uuid } from '../util/util';

/** Build a queue item. Callers add it inside the same Dexie transaction as the local write. */
export function queueItem(userId: string, entityKey: string, op: SyncOperation): SyncQueueItem {
  return {
    opId: uuid(),
    userId,
    entityKey,
    op,
    createdAt: Date.now(),
    attempts: 0,
    state: 'PENDING',
    lastError: null,
    nextAttemptAt: 0,
  };
}

export const entityKeys = {
  timeEntry: (id: string): string => `time:${id}`,
  order: (id: string): string => `order:${id}`,
  log: (id: string): string => `log:${id}`,
  photo: (id: string): string => `photo:${id}`,
  summary: (id: string): string => `summary:${id}`,
  authored: (id: string): string => `authored:${id}`,
} as const;

/** Exponential backoff with jitter: 2s, 4s, 8s … capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  const base = Math.min(300_000, 2_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** After this many transient failures an op is moved to FAILED so the queue cannot stall forever. */
export const MAX_TRANSIENT_ATTEMPTS = 8;
