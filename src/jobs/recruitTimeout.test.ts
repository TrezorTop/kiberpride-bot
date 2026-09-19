import { describe, expect, it, vi } from 'vitest';
import { runRecruitTimeout, staleCutoff, startRecruitTimeoutJob } from './recruitTimeout.js';

const now = new Date('2026-09-19T12:00:00Z');
const deps = (hours: number) => {
  const cancelStaleRecruitments = vi.fn(() => Promise.resolve([7]));
  return {
    cancelStaleRecruitments,
    deps: {
      settings: { get: () => Promise.resolve({ recruitTimeoutHours: hours } as never) },
      matches: { cancelStaleRecruitments },
      logging: { failure: vi.fn(() => Promise.resolve()) },
      clock: { now: () => now },
    },
  };
};

describe('recruit timeout decision (decision 009 §5)', () => {
  it('0 hours (or nonsense) means never', () => {
    expect(staleCutoff(now, 0)).toBeNull();
    expect(staleCutoff(now, -1)).toBeNull();
    expect(staleCutoff(now, Number.NaN)).toBeNull();
  });

  it('N hours cuts off matches created more than N hours ago', () => {
    expect(staleCutoff(now, 3)).toEqual(new Date('2026-09-19T09:00:00Z'));
    expect(staleCutoff(now, 24)).toEqual(new Date('2026-09-18T12:00:00Z'));
  });

  it('asks the service to cancel with the cutoff, or not at all when the timeout is off', async () => {
    const on = deps(3);
    expect(await runRecruitTimeout(on.deps)).toEqual([7]);
    expect(on.cancelStaleRecruitments).toHaveBeenCalledWith(new Date('2026-09-19T09:00:00Z'));

    const off = deps(0);
    expect(await runRecruitTimeout(off.deps)).toEqual([]);
    expect(off.cancelStaleRecruitments).not.toHaveBeenCalled();
  });

  it('does nothing while the bot is not serving its guild yet', () => {
    vi.useFakeTimers();
    try {
      const d = deps(3);
      const stop = startRecruitTimeoutJob({ ...d.deps, isReady: () => false }, 1000);
      vi.advanceTimersByTime(5000);
      expect(d.cancelStaleRecruitments).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
