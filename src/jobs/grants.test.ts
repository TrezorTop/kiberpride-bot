import { describe, expect, it, vi } from 'vitest';
import { runGrantsPass, startGrantsJob } from './grants.js';

const now = new Date('2026-09-20T12:00:00Z');

function fakeShop(order: string[]) {
  return {
    expirePass: vi.fn((at: Date) => (order.push(`expire@${at.toISOString()}`), Promise.resolve([1]))),
    warnPass: vi.fn((at: Date) => (order.push(`warn@${at.toISOString()}`), Promise.resolve([2]))),
    retryPass: vi.fn((at: Date) => (order.push(`retry@${at.toISOString()}`), Promise.resolve(3))),
  };
}

describe('grants job (decision 014 §4)', () => {
  it('expires first, then warns, then retries — all with the injected clock', async () => {
    const order: string[] = [];
    const result = await runGrantsPass({ shop: fakeShop(order), logging: { failure: vi.fn(() => Promise.resolve()) }, clock: { now: () => now } });
    const t = now.toISOString();
    expect(order).toEqual([`expire@${t}`, `warn@${t}`, `retry@${t}`]);
    expect(result).toEqual({ expired: [1], warned: [2], retried: 3 });
  });

  it('never overlaps a slow pass and idles until the guild is bound', async () => {
    vi.useFakeTimers();
    try {
      let ready = false;
      let release: () => void = () => {};
      const shop = {
        expirePass: vi.fn(() => new Promise<number[]>((r) => (release = () => r([])))),
        warnPass: vi.fn(() => Promise.resolve([])),
        retryPass: vi.fn(() => Promise.resolve(0)),
      };
      const stop = startGrantsJob({ shop, logging: { failure: vi.fn(() => Promise.resolve()) }, clock: { now: () => now }, isReady: () => ready }, 1000);
      vi.advanceTimersByTime(3000);
      expect(shop.expirePass).not.toHaveBeenCalled();
      ready = true;
      vi.advanceTimersByTime(5000);
      expect(shop.expirePass).toHaveBeenCalledTimes(1); // the first pass is still running
      release();
      await vi.runOnlyPendingTimersAsync();
      await vi.advanceTimersByTimeAsync(1000);
      expect(shop.expirePass.mock.calls.length).toBeGreaterThanOrEqual(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
