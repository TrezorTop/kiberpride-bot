// A keyed coalescing queue (decisions 008 §5, 014 §2): per key at most one run is active and at
// most one waits. A change committed while a run is active marks it for one more run, because the
// active run may have read the database before the change. Nothing in it is worth keeping: a
// restart loses it and the startup reconcile repairs everything.

export interface KeyedQueue<K> {
  /**
   * Schedules a run for the key. The promise settles once a run that STARTED after this call has
   * finished; it never rejects (failures go to `onError`).
   */
  enqueue(key: K): Promise<void>;
  /** Resolves when nothing is running or waiting (tests, shutdown). */
  idle(): Promise<void>;
}

export function createKeyedQueue<K>(run: (key: K) => Promise<void>, onError: (key: K, err: unknown) => void): KeyedQueue<K> {
  const active = new Map<K, { rerun: boolean; done: Promise<void> }>();

  return {
    enqueue(key) {
      const current = active.get(key);
      if (current) {
        current.rerun = true;
        return current.done;
      }
      const state = { rerun: false, done: Promise.resolve() };
      active.set(key, state);
      state.done = (async () => {
        try {
          do {
            state.rerun = false;
            try {
              await run(key);
            } catch (err) {
              onError(key, err);
            }
          } while (state.rerun);
        } finally {
          active.delete(key);
        }
      })();
      return state.done;
    },

    async idle() {
      while (active.size > 0) await Promise.all([...active.values()].map((s) => s.done));
    },
  };
}
