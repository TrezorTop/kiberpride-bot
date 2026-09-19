import { describe, expect, it, vi } from 'vitest';
import { runSyncRetry, startSyncRetryJob } from './syncRetry.js';

const deps = (ids: number[]) => {
  const enqueueSync = vi.fn(() => Promise.resolve());
  return {
    enqueueSync,
    deps: {
      matches: { unsynced: vi.fn(() => Promise.resolve(ids)), enqueueSync },
      logging: { failure: vi.fn(() => Promise.resolve()) },
    },
  };
};

describe('sync retry job (review 2026-09-20)', () => {
  it('queues every lagging match once per pass', async () => {
    const d = deps([3, 5]);
    expect(await runSyncRetry(d.deps)).toEqual([3, 5]);
    expect(d.enqueueSync.mock.calls).toEqual([[3], [5]]);
  });

  it('ticks every interval once ready, and does nothing before', async () => {
    vi.useFakeTimers();
    try {
      const d = deps([9]);
      let ready = false;
      const stop = startSyncRetryJob({ ...d.deps, isReady: () => ready }, 1000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(d.enqueueSync).not.toHaveBeenCalled();
      ready = true;
      await vi.advanceTimersByTimeAsync(2000);
      expect(d.enqueueSync).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(d.enqueueSync).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
