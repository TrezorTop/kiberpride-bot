import { describe, expect, it } from 'vitest';
import { floorToMinute, moscowDay, nextMoscowMidnight } from './clock.js';

describe('Moscow day (decision 014 §5): a fixed UTC+3', () => {
  it('turns at 21:00 UTC', () => {
    expect(moscowDay(new Date('2026-09-20T20:59:59.999Z'))).toBe('2026-09-20');
    expect(moscowDay(new Date('2026-09-20T21:00:00Z'))).toBe('2026-09-21');
    expect(moscowDay(new Date('2026-09-20T00:30:00Z'))).toBe('2026-09-20'); // 03:30 MSK
  });

  it('has no daylight saving: winter and summer are the same offset', () => {
    expect(moscowDay(new Date('2026-01-15T21:00:00Z'))).toBe('2026-01-16');
    expect(moscowDay(new Date('2026-07-15T21:00:00Z'))).toBe('2026-07-16');
  });

  it('crosses months and years', () => {
    expect(moscowDay(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
    expect(nextMoscowMidnight(new Date('2026-12-31T20:00:00Z'))).toEqual(new Date('2026-12-31T21:00:00Z'));
    expect(nextMoscowMidnight(new Date('2026-02-28T22:00:00Z'))).toEqual(new Date('2026-03-01T21:00:00Z'));
  });

  it('the next midnight is always later than now and at most a day away', () => {
    for (const iso of ['2026-09-20T20:59:59Z', '2026-09-20T21:00:00Z', '2026-09-20T12:00:00Z']) {
      const now = new Date(iso);
      const next = nextMoscowMidnight(now).getTime();
      expect(next).toBeGreaterThan(now.getTime());
      expect(next - now.getTime()).toBeLessThanOrEqual(86_400_000);
      expect(moscowDay(new Date(next))).not.toBe(moscowDay(now));
    }
  });

  it('floors to the whole minute', () => {
    expect(floorToMinute(new Date('2026-09-20T12:34:56.789Z'))).toEqual(new Date('2026-09-20T12:34:00Z'));
  });
});
