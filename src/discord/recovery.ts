// Startup recovery (decisions 004 §6, 008 §7, §9), in this order:
//   1. reconcileMembership — players of open matches who left while the bot was offline;
//   2. sync every match that is open or has syncedVersion < version (messages, channels,
//      announcements), so buttons and channels match the database;
//   3. delete orphaned team channels.
// Buttons work even before this finishes: custom_ids carry only ids (decision 002 §4). Each step
// is independent; one failing is logged and the next still runs.
import type { AppContext } from './router.js';

export async function recover(ctx: AppContext): Promise<void> {
  let left: string[] = [];
  try {
    left = await ctx.matches.reconcileMembership();
  } catch (err) {
    ctx.logger.error({ err }, 'recovery: membership check failed');
  }

  let synced = 0;
  try {
    const ids = await ctx.matches.needingSync();
    for (const id of ids) await ctx.matches.enqueueSync(id); // failures are logged by the queue
    synced = ids.length;
  } catch (err) {
    ctx.logger.error({ err }, 'recovery: listing matches to sync failed');
  }

  let orphans = 0;
  try {
    orphans = await ctx.matches.cleanupOrphans();
  } catch (err) {
    ctx.logger.error({ err }, 'recovery: orphan cleanup failed');
  }
  ctx.logger.info({ leftServer: left.length, synced, orphans }, 'recovery done');
}
