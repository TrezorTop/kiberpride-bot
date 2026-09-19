// Gateway health (rule bot-always-on §4): how long a drop lasted, and the watchdog that ends a
// process stuck without Discord so the container restarts it. Time and timers are injected.
import { Status, type Client } from 'discord.js';
import type { Clock } from '../core/clock.js';

/**
 * Connected = the client finished its first login AND every shard is Ready now. `isReady()`
 * alone is not enough: discord.js sets it once and keeps it true through a later gateway drop.
 */
export function isConnected(client: Client): boolean {
  return client.isReady() && client.ws.shards.every((shard) => shard.status === Status.Ready);
}

/** Remembers when each shard dropped; the first drop wins until the shard is back. */
export interface DropTracker {
  dropped(shardId: number, at: Date): void;
  /** Milliseconds the shard was down, or null when no drop was recorded (a first ready). */
  restored(shardId: number, at: Date): number | null;
}

export function createDropTracker(): DropTracker {
  const since = new Map<number, number>();
  return {
    dropped(shardId, at) {
      if (!since.has(shardId)) since.set(shardId, at.getTime());
    },
    restored(shardId, at) {
      const from = since.get(shardId);
      if (from === undefined) return null;
      since.delete(shardId);
      return Math.max(0, at.getTime() - from);
    },
  };
}

/** The log-channel line after a drop. Russian: the owner may read the log channel. */
export function restoredLine(downMs: number): string {
  const minutes = Math.round(downMs / 60_000);
  const span = minutes < 1 ? 'меньше минуты' : `${minutes} мин`;
  return `⚠️ Связь с Discord пропадала ${span}, восстановлена`;
}

export interface WatchdogOptions {
  isConnected: () => boolean;
  clock: Clock;
  /** Disconnected for strictly longer than this → `onStuck`. */
  maxDisconnectedMs: number;
  onStuck: (disconnectedMs: number) => void;
}

/** The decision alone, one call per tick: fires `onStuck` once, after a continuous outage. */
export function createWatchdog(options: WatchdogOptions): { tick(): void } {
  let downSince: number | null = null;
  let fired = false;
  return {
    tick() {
      if (fired) return;
      const now = options.clock.now().getTime();
      if (options.isConnected()) {
        downSince = null;
        return;
      }
      downSince ??= now;
      const down = now - downSince;
      if (down > options.maxDisconnectedMs) {
        fired = true;
        options.onStuck(down);
      }
    },
  };
}

export type Every = (fn: () => void, ms: number) => () => void;

/** setInterval that does not keep the process alive on its own; returns the stop function. */
export const every: Every = (fn, ms) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export function startWatchdog(options: WatchdogOptions & { intervalMs: number; every?: Every }): () => void {
  const watchdog = createWatchdog(options);
  return (options.every ?? every)(() => watchdog.tick(), options.intervalMs);
}
