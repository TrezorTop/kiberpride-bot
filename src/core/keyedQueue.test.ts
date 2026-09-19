import { describe, expect, it } from 'vitest';
import { createKeyedQueue } from './keyedQueue.js';

describe('keyed coalescing queue (decisions 008 §5, 014 §2)', () => {
  it('runs at most one pass per key at a time and folds a burst into one more pass', async () => {
    const runs: string[] = [];
    let active = 0;
    let maxActive = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const queue = createKeyedQueue<string>(
      async (key) => {
        active++;
        maxActive = Math.max(maxActive, active);
        runs.push(key);
        if (runs.length === 1) await gate;
        active--;
      },
      () => {},
    );
    const first = queue.enqueue('a');
    const burst = Array.from({ length: 5 }, () => queue.enqueue('a'));
    release();
    await Promise.all([first, ...burst]);
    expect(runs).toEqual(['a', 'a']); // the running pass plus exactly one rerun
    expect(maxActive).toBe(1);
  });

  it('runs different keys independently and reports failures without rejecting', async () => {
    const errors: string[] = [];
    const queue = createKeyedQueue<string>(
      (key) => (key === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve()),
      (key) => errors.push(key),
    );
    await Promise.all([queue.enqueue('bad'), queue.enqueue('good')]);
    await queue.idle();
    expect(errors).toEqual(['bad']);
  });
});
