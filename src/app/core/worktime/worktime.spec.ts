import { describe, expect, it } from 'vitest';
import type { IsoDate, TimeEntry } from '../models/domain.models';
import { addDays, analyzeMonth, hm, isMonth, monthWindow, mondayOf, shiftMonth } from './worktime';

const at = (date: string, h: number, m = 0): number => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
let seq = 0;
const shift = (date: string, from: [number, number], to: [number, number], declared = false): TimeEntry => ({
  id: String(++seq),
  userId: 'u',
  kind: 'SHIFT',
  workOrderId: null,
  date: date as IsoDate,
  startedAt: at(date, ...from),
  endedAt: at(date, ...to),
  endSource: declared ? 'DECLARED' : 'TAP',
});
const NOW = at('2026-10-31', 23);
const days = (list: string[]): TimeEntry[] => list.map((d) => shift(`2026-10-${d}`, [7, 0], [15, 0]));

describe('calendar helpers', () => {
  it('moves across months and years without daylight-saving drift', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(isMonth('2026-13')).toBe(false);
  });

  it('loads the year so far plus the week before it', () => {
    const w = monthWindow('2026-10');
    expect(w.from <= '2026-01-01').toBe(true);
    expect(w.to >= '2026-10-31').toBe(true);
  });

  it('formats hours as h:mm', () => {
    expect(hm(465)).toBe('7:45');
    expect(hm(0)).toBe('0:00');
  });
});

describe('overtime and limits (ZDR-1)', () => {
  it('counts time past 8 h a day as overtime', () => {
    const m = analyzeMonth([shift('2026-10-05', [6, 0], [16, 30])], '2026-10', NOW);
    expect(m.overtime).toBe(150);
    expect(m.issues.some((i) => i.kind === 'DAY_OVER')).toBe(true);
  });

  it('counts a sixth eight-hour day as overtime through the 40 h week', () => {
    const m = analyzeMonth(days(['05', '06', '07', '08', '09', '10']), '2026-10', NOW);
    expect(m.regular).toBe(40 * 60);
    expect(m.overtime).toBe(8 * 60);
    expect(m.issues.some((i) => i.kind === 'OT_WEEK')).toBe(false);
    expect(m.issues.some((i) => i.kind === 'REST_WEEKLY')).toBe(false);
  });

  it('flags less than 12 h of rest between two days', () => {
    const m = analyzeMonth([shift('2026-10-05', [12, 0], [22, 0]), shift('2026-10-06', [6, 0], [14, 0])], '2026-10', NOW);
    expect(m.issues.find((i) => i.kind === 'REST_DAILY')?.value).toBe(8 * 60);
  });

  it('flags a week without 24 h of rest and a week over 56 h', () => {
    const m = analyzeMonth(
      ['05', '06', '07', '08', '09', '10', '11'].map((d) => shift(`2026-10-${d}`, [6, 0], [20, 0])),
      '2026-10',
      NOW,
    );
    expect(m.issues.some((i) => i.kind === 'REST_WEEKLY')).toBe(true);
    expect(m.issues.some((i) => i.kind === 'WEEK_OVER')).toBe(true);
    expect(m.issues.some((i) => i.kind === 'OT_MONTH')).toBe(true);
    expect(m.level).toBe('over');
  });

  it('treats an end entered afterwards as a note, not a breach', () => {
    const m = analyzeMonth([shift('2026-10-05', [7, 0], [15, 0], true)], '2026-10', NOW);
    expect(m.level).toBe('note');
  });

  it('reports a clean month as within limits', () => {
    const m = analyzeMonth(days(['05', '06']), '2026-10', NOW);
    expect(m.level).toBe('ok');
    expect(m.overtime).toBe(0);
    expect(m.minutes).toBe(16 * 60);
  });

  it('adds up overtime from earlier months for the yearly cap', () => {
    const earlier = Array.from({ length: 20 }, (_, i) => shift(`2026-0${3 + (i % 6)}-1${i % 9}`, [6, 0], [16, 0]));
    const m = analyzeMonth([...earlier, shift('2026-10-05', [7, 0], [15, 0])], '2026-10', NOW);
    expect(m.overtimeYear).toBeGreaterThanOrEqual(20 * 120);
  });
});
