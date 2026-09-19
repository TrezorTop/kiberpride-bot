// Sync retry (review 2026-09-20): every minute, every match whose Discord side lags the database
// (syncedVersion < version) is queued for sync again, so a failed sync repairs itself without a
// new change, a panel press or a restart. The queue coalesces with syncs already running and
// reports failures (once per match version to the log channel — modules/matches/syncFailures.ts).
import type { LoggingService } from '../modules/logging/service.js';
import type { MatchesService } from '../modules/matches/service.js';

export const SYNC_RETRY_INTERVAL_MS = 60_000;

export interface SyncRetryDeps {
  matches: Pick<MatchesService, 'unsynced' | 'enqueueSync'>;
  logging: Pick<LoggingService, 'failure'>;
  /** False until the bot serves its guild: a sync would fail for want of a guild. */
  isReady?: () => boolean;
}

/** One pass: queues every lagging match and waits for those syncs. Returns the ids. */
export async function runSyncRetry(deps: SyncRetryDeps): Promise<number[]> {
  const ids = await deps.matches.unsynced();
  await Promise.all(ids.map((id) => deps.matches.enqueueSync(id))); // never rejects (syncQueue)
  return ids;
}

/** Starts the minute tick; returns the stop function. A slow pass is never overlapped. */
export function startSyncRetryJob(deps: SyncRetryDeps, intervalMs = SYNC_RETRY_INTERVAL_MS): () => void {
  let running = false;
  const tick = () => {
    if (running || (deps.isReady && !deps.isReady())) return;
    running = true;
    runSyncRetry(deps)
      .catch((err: unknown) => deps.logging.failure('job.sync_retry_failed', { err }))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
