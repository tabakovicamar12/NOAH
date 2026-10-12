import type { WorkOrderStatus } from '../../core/models/domain.models';
import type { IconName } from './icon.component';

/**
 * Whole-tag fills for a work order. The tag colour is the status; the word and glyph repeat it,
 * so it still reads in glare, greyscale and for colour-blind crews.
 */
export const TAG_FILL: Readonly<Record<WorkOrderStatus, { readonly cls: string; readonly muted: string; readonly icon: IconName }>> = {
  NEW: { cls: 'bg-stock text-ink', muted: 'text-ink-muted', icon: 'plus' },
  IN_PROGRESS: { cls: 'bg-gold text-ink', muted: 'text-gold-ink', icon: 'play' },
  COMPLETED: { cls: 'bg-done text-white', muted: 'text-white/85', icon: 'check' },
  ISSUE: { cls: 'bg-hold text-white', muted: 'text-white/85', icon: 'alert' },
};

/** Progress ratio 0..1, safe for a zero plan. */
export function progressRatio(done: number, planned: number): number {
  if (!(planned > 0)) return done > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, done / planned));
}
