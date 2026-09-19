// Time is injected so expiry and reconcilers are testable without waiting.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

// Moscow time is a fixed UTC+3 with no daylight saving since 2014 (decision 014 §5): the
// daily bonus and voice time count calendar days there, whatever the server's time zone.
const MOSCOW_OFFSET_MS = 3 * 3_600_000;

/** The Moscow calendar day of an instant, `YYYY-MM-DD`. */
export function moscowDay(at: Date): string {
  return new Date(at.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant the next Moscow day begins (00:00 MSK = 21:00 UTC the day before). */
export function nextMoscowMidnight(at: Date): Date {
  const shifted = new Date(at.getTime() + MOSCOW_OFFSET_MS);
  const nextDayUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return new Date(nextDayUtc - MOSCOW_OFFSET_MS);
}

/** The instant floored to its whole minute: one voice tick = one minute (014 §6). */
export function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}
