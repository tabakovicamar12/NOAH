import { describe, expect, it } from 'vitest';
import { compareCodes, formatDuration, minutesBetween } from './util';

describe('compareCodes', () => {
  it('orders work order numbers naturally', () => {
    const codes = ['2026-1000', '2026-010', '2026-999', '2026-002'];
    expect([...codes].sort(compareCodes)).toEqual(['2026-002', '2026-010', '2026-999', '2026-1000']);
  });

  it('puts orders without a number last', () => {
    expect([null, '2026-001'].sort(compareCodes)).toEqual(['2026-001', null]);
  });
});

describe('durations', () => {
  it('never counts negative time when the device clock jumps back', () => {
    expect(minutesBetween(10_000_000, 9_000_000)).toBe(0);
  });

  it('formats minutes as HH:MM', () => {
    expect(formatDuration(465)).toBe('07:45');
  });
});
