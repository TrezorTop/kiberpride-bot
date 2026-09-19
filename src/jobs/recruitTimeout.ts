// Auto-close of stale recruitments (decision 009 §5): every minute, RECRUITING matches older than
// GuildSettings.recruitTimeoutHours are cancelled through the matches service's cancel path —
// players pinged by the CANCELLED announcement, no KP moves, «набор закрыт по времени» in the log
// channel. 0 hours = never. TEAMS_PENDING and IN_PROGRESS never time out. Stateless between runs.
import type { Clock } from '../core/clock.js';
import type { LoggingService } from '../modules/logging/service.js';
import type { MatchesService } from '../modules/matches/service.js';
import type { SettingsService } from '../modules/settings/service.js';

export const RECRUIT_TIMEOUT_INTERVAL_MS = 60_000;

/** The creation time before which a recruitment is stale; null = the timeout is off. */
export function staleCutoff(now: Date, timeoutHours: number): Date | null {
  if (!Number.isFinite(timeoutHours) || timeoutHours <= 0) return null;
  return new Date(now.getTime() - timeoutHours * 3_600_000);
}

export interface RecruitTimeoutDeps {
  settings: Pick<SettingsService, 'get'>;
  matches: Pick<MatchesService, 'cancelStaleRecruitments'>;
  logging: Pick<LoggingService, 'failure'>;
  clock: Clock;
  /** False until the bot serves its guild: a cancel would then have nobody to announce it to. */
  isReady?: () => boolean;
}

/** One pass. Returns the ids it cancelled. */
export async function runRecruitTimeout(deps: RecruitTimeoutDeps): Promise<number[]> {
  const { recruitTimeoutHours } = await deps.settings.get();
  const cutoff = staleCutoff(deps.clock.now(), recruitTimeoutHours);
  if (!cutoff) return [];
  return deps.matches.cancelStaleRecruitments(cutoff);
}

/** Starts the minute tick; returns the stop function. A slow pass is never overlapped. */
export function startRecruitTimeoutJob(deps: RecruitTimeoutDeps, intervalMs = RECRUIT_TIMEOUT_INTERVAL_MS): () => void {
  let running = false;
  const tick = () => {
    if (running || (deps.isReady && !deps.isReady())) return;
    running = true;
    runRecruitTimeout(deps)
      .catch((err: unknown) =>
        deps.logging.failure('job.recruit_timeout_failed', { err }, '⚠️ Не удалось проверить просроченные наборы — попробую через минуту.'),
      )
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
