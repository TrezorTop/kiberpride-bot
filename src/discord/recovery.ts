// Startup recovery (decision 004 §6): every match with a non-terminal status or
// syncedVersion < version is synced, so recruitment messages and voice channels match the
// database and their buttons keep working. The matches module is not built yet; buttons already
// survive a restart because custom_ids carry only ids (decision 002 §4).
import type { AppContext } from './router.js';

export async function recover(ctx: AppContext): Promise<void> {
  ctx.logger.info('recovery: no match module yet — nothing to re-attach');
  await Promise.resolve();
}
