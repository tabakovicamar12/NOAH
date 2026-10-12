import type { I18nService } from '../../../core/i18n/i18n.service';
import type { TranslationKey } from '../../../core/i18n/sl';
import { WorkflowError } from './worker-store.service';

const MESSAGES: Readonly<Record<WorkflowError['code'], TranslationKey>> = {
  NO_SESSION: 'common.errorGeneric',
  NO_SHIFT: 'order.needShift',
  SHIFT_OPEN: 'day.needEnd',
  STALE_SHIFT: 'stale.blocked',
  NOT_FOUND: 'order.notFound',
  INVALID_TRANSITION: 'common.errorGeneric',
  INVALID_INPUT: 'order.textRequired',
  INVALID_TIME: 'stale.invalidTime',
  REPORT_LOCKED: 'day.locked',
  STORAGE_FULL: 'photo.storageFull',
};

/** User-facing text for a failed field action. Unknown failures still promise the data is safe. */
export function workflowMessage(i18n: I18nService, err: unknown): string {
  if (err instanceof WorkflowError) return i18n.t(MESSAGES[err.code]);
  console.error('[AON] field action failed', err);
  return i18n.t('common.unexpected');
}

/** Milliseconds worked on one order across the given entries; open segments run to `now`. */
export function orderElapsedMs(
  entries: ReadonlyArray<{ readonly kind: string; readonly workOrderId: string | null; readonly startedAt: number; readonly endedAt: number | null }>,
  orderId: string,
  now: number,
): number {
  return entries
    .filter((e) => e.kind === 'ORDER' && e.workOrderId === orderId)
    .reduce((sum, e) => sum + Math.max(0, (e.endedAt ?? now) - e.startedAt), 0);
}
