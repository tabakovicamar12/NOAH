import type { IsoDate, TimeEntry } from '../models/domain.models';

/**
 * Working-time limits from the Slovenian Employment Relationships Act (ZDR-1). Breaks count as working time
 * (art. 154), so a shift is counted from start to end. Several limits may be met as an average over a reference
 * period set by law or a collective agreement (at most six months), so the app reports them as warnings for the
 * employer to check, not as proven breaches.
 */
export const WORKTIME_RULES = {
  /** Full-time day and week; work beyond them is overtime (ZDR-1, art. 142 and 144). */
  regularDayMin: 8 * 60,
  regularWeekMin: 40 * 60,
  /** Longest working day including overtime. */
  maxDayMin: 10 * 60,
  /** Longest week under an uneven schedule (ZDR-1, art. 148). */
  maxWeekMin: 56 * 60,
  /** Overtime caps (ZDR-1, art. 144). The yearly cap may reach 230 h only with the worker's written consent. */
  overtimeWeekMin: 8 * 60,
  overtimeMonthMin: 20 * 60,
  overtimeYearMin: 170 * 60,
  overtimeYearConsentMin: 230 * 60,
  /** Rest: 12 h in 24 (art. 155) and 24 h in a week (art. 156). */
  dailyRestMin: 12 * 60,
  weeklyRestMin: 24 * 60,
  /** Share of a cap from which the app starts to warn. */
  warnShare: 0.8,
} as const;

export type WorkIssueKind =
  | 'DAY_OVER'
  | 'WEEK_OVER'
  | 'REST_DAILY'
  | 'REST_WEEKLY'
  | 'OT_WEEK'
  | 'OT_MONTH'
  | 'OT_YEAR'
  | 'OT_MONTH_NEAR'
  | 'OT_YEAR_NEAR'
  | 'OPEN_LONG'
  | 'DECLARED_END';

export type WorkIssueLevel = 'over' | 'near' | 'note';

export interface WorkIssue {
  readonly kind: WorkIssueKind;
  readonly level: WorkIssueLevel;
  /** The day (or first day of the week) the finding belongs to. */
  readonly date: IsoDate;
  /** Measured minutes and the limit they were held against. */
  readonly value: number;
  readonly limit: number;
}

export interface WorkDay {
  readonly date: IsoDate;
  readonly shifts: readonly TimeEntry[];
  readonly firstStart: number;
  /** Null while a shift of the day is still running. */
  readonly lastEnd: number | null;
  readonly minutes: number;
  readonly regular: number;
  readonly overtime: number;
  /** At least one end was stated afterwards instead of tapped. */
  readonly declared: boolean;
  /** Minutes since the previous working day ended; null when there is no earlier day in the data. */
  readonly restBefore: number | null;
}

export interface WorkWeek {
  /** Monday of the ISO week. */
  readonly start: IsoDate;
  readonly minutes: number;
  readonly overtime: number;
  /** Longest stretch without work inside the week; null while the week is not over yet. */
  readonly longestRest: number | null;
}

export interface WorkMonth {
  readonly month: string;
  /** Days of the month with work, oldest first. */
  readonly days: readonly WorkDay[];
  /** Weeks that touch the month. */
  readonly weeks: readonly WorkWeek[];
  readonly minutes: number;
  readonly regular: number;
  readonly overtime: number;
  readonly overtimeYear: number;
  readonly longestDay: number;
  readonly issues: readonly WorkIssue[];
  readonly level: 'ok' | WorkIssueLevel;
}

/** Calendar arithmetic on YYYY-MM-DD strings, in UTC so daylight-saving changes never shift a day. */
export function addDays(date: string, n: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10) as IsoDate;
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): IsoDate {
  return addDays(date, -weekday(date));
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthDays(month: string): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = `${month}-01` as IsoDate; monthOf(d) === month; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The data a month needs: the whole year so far (yearly overtime) and the week before it (rest, weekly totals). */
export function monthWindow(month: string): { from: IsoDate; to: IsoDate } {
  const yearStart = `${month.slice(0, 4)}-01-01`;
  return { from: mondayOf(addDays(yearStart, -7)), to: addDays(`${shiftMonth(month, 1)}-01`, 6) };
}

function shiftMinutes(e: TimeEntry, now: number): number {
  return Math.max(0, Math.floor(((e.endedAt ?? now) - e.startedAt) / 60_000));
}

/**
 * Working days with overtime. A day's overtime is what goes past 8 h; within an ISO week, regular time past
 * 40 h is overtime as well (e.g. a sixth eight-hour day).
 */
export function workDays(shifts: readonly TimeEntry[], now: number): WorkDay[] {
  const byDate = new Map<string, TimeEntry[]>();
  for (const s of shifts) {
    if (s.kind !== 'SHIFT') continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  const dates = [...byDate.keys()].sort();
  const out: WorkDay[] = [];
  let week = '';
  let weekRegular = 0;
  let prevEnd: number | null = null;
  for (const date of dates) {
    const list = (byDate.get(date) ?? []).sort((a, b) => a.startedAt - b.startedAt);
    const minutes = list.reduce((sum, s) => sum + shiftMinutes(s, now), 0);
    const monday = mondayOf(date);
    if (monday !== week) {
      week = monday;
      weekRegular = 0;
    }
    let regular = Math.min(minutes, WORKTIME_RULES.regularDayMin);
    const weekRoom = Math.max(0, WORKTIME_RULES.regularWeekMin - weekRegular);
    regular = Math.min(regular, weekRoom);
    weekRegular += regular;
    const open = list.some((s) => s.endedAt === null);
    const firstStart = list[0]?.startedAt ?? 0;
    const lastEnd = open ? null : Math.max(...list.map((s) => s.endedAt ?? 0));
    out.push({
      date: date as IsoDate,
      shifts: list,
      firstStart,
      lastEnd,
      minutes,
      regular,
      overtime: minutes - regular,
      declared: list.some((s) => s.endSource === 'DECLARED'),
      restBefore: prevEnd === null ? null : Math.max(0, Math.floor((firstStart - prevEnd) / 60_000)),
    });
    prevEnd = lastEnd ?? now;
  }
  return out;
}

/** One worker's month: totals, weeks and every finding against the limits above. */
export function analyzeMonth(shifts: readonly TimeEntry[], month: string, now: number): WorkMonth {
  const R = WORKTIME_RULES;
  const all = workDays(shifts, now);
  const days = all.filter((d) => monthOf(d.date) === month);
  const year = month.slice(0, 4);
  const issues: WorkIssue[] = [];

  for (const d of days) {
    if (d.minutes > R.maxDayMin) issues.push({ kind: 'DAY_OVER', level: 'over', date: d.date, value: d.minutes, limit: R.maxDayMin });
    if (d.restBefore !== null && d.restBefore < R.dailyRestMin) {
      issues.push({ kind: 'REST_DAILY', level: 'over', date: d.date, value: d.restBefore, limit: R.dailyRestMin });
    }
    const running = d.shifts.find((s) => s.endedAt === null);
    if (running && shiftMinutes(running, now) > R.maxDayMin) {
      issues.push({ kind: 'OPEN_LONG', level: 'over', date: d.date, value: shiftMinutes(running, now), limit: R.maxDayMin });
    }
    if (d.declared) issues.push({ kind: 'DECLARED_END', level: 'note', date: d.date, value: d.minutes, limit: 0 });
  }

  // Weeks that touch the month, Monday to Sunday.
  const weeks: WorkWeek[] = [];
  const first = mondayOf(`${month}-01`);
  for (let start = first; monthOf(start) <= month; start = addDays(start, 7)) {
    const end = addDays(start, 7);
    const inWeek = all.filter((d) => d.date >= start && d.date < end);
    const minutes = inWeek.reduce((s, d) => s + d.minutes, 0);
    const overtime = inWeek.reduce((s, d) => s + d.overtime, 0);
    const weekEndMs = Date.parse(`${end}T00:00:00`);
    let longestRest: number | null = null;
    if (weekEndMs <= now) {
      let cursor = Date.parse(`${start}T00:00:00`);
      let longest = 0;
      for (const s of inWeek.flatMap((d) => d.shifts)) {
        longest = Math.max(longest, s.startedAt - cursor);
        cursor = Math.max(cursor, s.endedAt ?? now);
      }
      longest = Math.max(longest, weekEndMs - cursor);
      longestRest = Math.floor(longest / 60_000);
    }
    weeks.push({ start, minutes, overtime, longestRest });
    if (minutes > R.maxWeekMin) issues.push({ kind: 'WEEK_OVER', level: 'over', date: start, value: minutes, limit: R.maxWeekMin });
    if (overtime > R.overtimeWeekMin) issues.push({ kind: 'OT_WEEK', level: 'over', date: start, value: overtime, limit: R.overtimeWeekMin });
    if (longestRest !== null && inWeek.length > 0 && longestRest < R.weeklyRestMin) {
      issues.push({ kind: 'REST_WEEKLY', level: 'over', date: start, value: longestRest, limit: R.weeklyRestMin });
    }
  }

  const minutes = days.reduce((s, d) => s + d.minutes, 0);
  const regular = days.reduce((s, d) => s + d.regular, 0);
  const overtime = minutes - regular;
  const overtimeYear = all.filter((d) => d.date.startsWith(year) && monthOf(d.date) <= month).reduce((s, d) => s + d.overtime, 0);
  const monthStart = `${month}-01` as IsoDate;
  if (overtime > R.overtimeMonthMin) issues.push({ kind: 'OT_MONTH', level: 'over', date: monthStart, value: overtime, limit: R.overtimeMonthMin });
  else if (overtime >= R.overtimeMonthMin * R.warnShare) issues.push({ kind: 'OT_MONTH_NEAR', level: 'near', date: monthStart, value: overtime, limit: R.overtimeMonthMin });
  if (overtimeYear > R.overtimeYearMin) issues.push({ kind: 'OT_YEAR', level: 'over', date: monthStart, value: overtimeYear, limit: R.overtimeYearMin });
  else if (overtimeYear >= R.overtimeYearMin * R.warnShare) issues.push({ kind: 'OT_YEAR_NEAR', level: 'near', date: monthStart, value: overtimeYear, limit: R.overtimeYearMin });

  issues.sort((a, b) => a.date.localeCompare(b.date));
  const level = issues.some((i) => i.level === 'over') ? 'over' : issues.some((i) => i.level === 'near') ? 'near' : issues.length ? 'note' : 'ok';
  return {
    month,
    days,
    weeks,
    minutes,
    regular,
    overtime,
    overtimeYear,
    longestDay: days.reduce((m, d) => Math.max(m, d.minutes), 0),
    issues,
    level,
  };
}

/** `7:45` style hours for reports: no leading zero, minutes always two digits. */
export function hm(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
