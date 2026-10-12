import type { I18nService } from '../../core/i18n/i18n.service';

/** "8 h" or "7 h 30 min": how a planned duration is said on site. */
export function hoursLabel(i18n: I18nService, minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (m === 0) return i18n.t('common.hours', { h });
  if (h === 0) return i18n.t('common.minutes', { m });
  return i18n.t('common.hoursMinutes', { h, m });
}

/** "Luka K." for tight table cells; the full name stays in the title and the drill-down. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0]} ${parts[parts.length - 1]?.charAt(0) ?? ''}.`;
}

/** "Marko K. +2" for a crew in one cell. */
export function crewLabel(names: readonly string[], none: string): string {
  if (names.length === 0) return none;
  const first = shortName(names[0] ?? '');
  return names.length === 1 ? first : `${first} +${names.length - 1}`;
}
