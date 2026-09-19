// Purchase grants over time (decision 014 §2, §4): every minute, in this order —
//   1. expire ACTIVE rows past their end (clans closed in the same transaction), then reconcile;
//   2. claim and send the one warning a day before the end (after expiry, so a row ending now is
//      never warned as «tomorrow»);
//   3. re-queue unapplied grants of present buyers and ended rows not cleaned up yet — the pass
//      itself refunds a grant that never worked for 30 minutes.
// A pass never overlaps the previous one; the clock is injected; the job idles until the guild
// is bound. Stateless between runs: everything it needs is in the database.
import type { Clock } from '../core/clock.js';
import type { LoggingService } from '../modules/logging/service.js';
import type { ShopService } from '../modules/shop/service.js';

export const GRANTS_INTERVAL_MS = 60_000;

export interface GrantsJobDeps {
  shop: Pick<ShopService, 'expirePass' | 'warnPass' | 'retryPass'>;
  logging: Pick<LoggingService, 'failure'>;
  clock: Clock;
  isReady?: () => boolean;
}

export async function runGrantsPass(deps: GrantsJobDeps): Promise<{ expired: number[]; warned: number[]; retried: number }> {
  const now = deps.clock.now();
  const expired = await deps.shop.expirePass(now);
  const warned = await deps.shop.warnPass(now);
  const retried = await deps.shop.retryPass(now);
  return { expired, warned, retried };
}

/** Starts the minute tick; returns the stop function. */
export function startGrantsJob(deps: GrantsJobDeps, intervalMs = GRANTS_INTERVAL_MS): () => void {
  let running = false;
  const tick = () => {
    if (running || (deps.isReady && !deps.isReady())) return;
    running = true;
    runGrantsPass(deps)
      .catch((err: unknown) => deps.logging.failure('job.grants_failed', { err }, '⚠️ Не удалось проверить сроки покупок — попробую через минуту.'))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
