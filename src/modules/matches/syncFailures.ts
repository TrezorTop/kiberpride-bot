// Sync failure reports (review 2026-09-20): the sync-retry job (src/jobs/syncRetry.ts) re-runs a
// failed sync every minute, so the log channel hears about a failure once per (match, version)
// in this process; the process log gets every attempt. Memory: one number per failed match.

export interface FailureDedupe {
  /** True the first time this (match, version) failed in this process. */
  firstFor(matchId: number, version: number): boolean;
}

export function createFailureDedupe(): FailureDedupe {
  const reported = new Map<number, number>();
  return {
    firstFor(matchId, version) {
      if (reported.get(matchId) === version) return false;
      reported.set(matchId, version);
      return true;
    },
  };
}
