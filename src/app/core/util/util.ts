import type { EpochMs, IsoDate } from '../models/domain.models';

/** RFC 4122 v4 id. Uses crypto.randomUUID when available (secure contexts), otherwise getRandomValues. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Local-time ISO date (YYYY-MM-DD) for a timestamp. */
export function toIsoDate(ms: EpochMs = Date.now()): IsoDate {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}` as IsoDate;
}

export function isIsoDate(value: string): value is IsoDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Whole minutes between two timestamps, never negative (guards against device clock changes). */
export function minutesBetween(start: EpochMs, end: EpochMs): number {
  return Math.max(0, Math.floor((end - start) / 60_000));
}

/** `HH:MM` for a duration in minutes. */
export function formatDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `HH:MM:SS` for a running timer in milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Hours with one decimal, e.g. 4.2 */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** Runs an async operation and never throws: every async boundary in the app goes through this. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

/** Order and project numbers in natural order: 2026-999 before 2026-1000, missing numbers last. */
export function compareCodes(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return a.localeCompare(b, undefined, { numeric: true });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
