import { describe, expect, it } from 'vitest';
import type { Clock } from '../core/clock.js';
import { createDropTracker, createWatchdog, restoredLine, startWatchdog, type Every } from './connection.js';

const MIN = 60_000;

function fakeClock(start = 0): Clock & { advance(ms: number): void } {
  let t = start;
  return { now: () => new Date(t), advance: (ms) => void (t += ms) };
}

describe('watchdog', () => {
  function setup() {
    const clock = fakeClock();
    let connected = false;
    const fired: number[] = [];
    const watchdog = createWatchdog({
      isConnected: () => connected,
      clock,
      maxDisconnectedMs: 5 * MIN,
      onStuck: (ms) => fired.push(ms),
    });
    return { clock, watchdog, fired, setConnected: (v: boolean) => void (connected = v) };
  }

  it('fires only after MORE than five continuous minutes without Discord', () => {
    const { clock, watchdog, fired } = setup();
    watchdog.tick(); // outage starts being counted here
    clock.advance(5 * MIN);
    watchdog.tick();
    expect(fired).toEqual([]);
    clock.advance(1_000);
    watchdog.tick();
    expect(fired).toEqual([5 * MIN + 1_000]);
  });

  it('forgets an outage once the connection is back', () => {
    const { clock, watchdog, fired, setConnected } = setup();
    watchdog.tick();
    clock.advance(4 * MIN);
    setConnected(true);
    watchdog.tick();
    setConnected(false);
    clock.advance(MIN);
    watchdog.tick(); // a new outage starts at 5 min
    clock.advance(4 * MIN);
    watchdog.tick();
    expect(fired).toEqual([]);
  });

  it('never fires while connected, and fires once only', () => {
    const { clock, watchdog, fired, setConnected } = setup();
    setConnected(true);
    for (let i = 0; i < 20; i++) {
      clock.advance(MIN);
      watchdog.tick();
    }
    expect(fired).toEqual([]);
    setConnected(false);
    for (let i = 0; i < 20; i++) {
      watchdog.tick();
      clock.advance(MIN);
    }
    expect(fired).toHaveLength(1);
  });

  it('runs on the injected interval and stops', () => {
    const clock = fakeClock();
    let scheduled: { fn: () => void; ms: number } | null = null;
    let stopped = false;
    const every: Every = (fn, ms) => {
      scheduled = { fn, ms };
      return () => void (stopped = true);
    };
    const fired: number[] = [];
    const stop = startWatchdog({
      isConnected: () => false,
      clock,
      maxDisconnectedMs: 5 * MIN,
      onStuck: (ms) => fired.push(ms),
      intervalMs: 30_000,
      every,
    });
    const s = scheduled as { fn: () => void; ms: number } | null;
    expect(s?.ms).toBe(30_000);
    for (let i = 0; i <= 11; i++) {
      s?.fn();
      clock.advance(30_000);
    }
    expect(fired).toEqual([5 * MIN + 30_000]);
    stop();
    expect(stopped).toBe(true);
  });
});

describe('drop tracker', () => {
  it('measures from the first drop to the restore, then forgets', () => {
    const tracker = createDropTracker();
    tracker.dropped(0, new Date(1_000));
    tracker.dropped(0, new Date(90_000)); // a reconnect attempt inside the same outage
    expect(tracker.restored(0, new Date(181_000))).toBe(180_000);
    expect(tracker.restored(0, new Date(200_000))).toBeNull();
  });

  it('reports nothing for a first ready with no drop before it', () => {
    expect(createDropTracker().restored(0, new Date())).toBeNull();
  });
});

describe('restoredLine', () => {
  it('says the minutes, and «меньше минуты» for a blip', () => {
    expect(restoredLine(3 * MIN)).toBe('⚠️ Связь с Discord пропадала 3 мин, восстановлена');
    expect(restoredLine(20_000)).toBe('⚠️ Связь с Discord пропадала меньше минуты, восстановлена');
  });
});
