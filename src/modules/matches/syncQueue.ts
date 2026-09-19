// The coalescing sync queue (decision 008 §5): per match at most one sync runs and at most one
// waits. Ten joins in a second become two syncs, not ten message edits. It holds no state worth
// keeping — a restart loses it and the startup sync repairs everything (004 §6).

export interface SyncQueue {
  /**
   * Schedules a sync of the match. The promise settles once a sync that STARTED after this call
   * has finished (it never rejects — failures go to `onError`).
   */
  enqueue(matchId: number): Promise<void>;
  /** Resolves when nothing is running or waiting (tests, shutdown). */
  idle(): Promise<void>;
}

export function createSyncQueue(run: (matchId: number) => Promise<void>, onError: (matchId: number, err: unknown) => void): SyncQueue {
  const active = new Map<number, { rerun: boolean; done: Promise<void> }>();

  return {
    enqueue(matchId) {
      const current = active.get(matchId);
      if (current) {
        current.rerun = true; // the running sync may have read the database before this change
        return current.done;
      }
      const state = { rerun: false, done: Promise.resolve() };
      active.set(matchId, state);
      state.done = (async () => {
        try {
          do {
            state.rerun = false;
            try {
              await run(matchId);
            } catch (err) {
              onError(matchId, err);
            }
          } while (state.rerun);
        } finally {
          active.delete(matchId);
        }
      })();
      return state.done;
    },

    async idle() {
      while (active.size > 0) await Promise.all([...active.values()].map((s) => s.done));
    },
  };
}
