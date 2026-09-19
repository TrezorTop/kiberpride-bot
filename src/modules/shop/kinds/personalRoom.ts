// `personal_room` (decision 014 §3.3): a voice channel the bot owns in the chosen category. The
// buyer controls it only through the bot's panel — they get View and Connect, never Manage
// Channels or Manage Permissions — so convergence may write the name, the limit and every
// overwrite in full on each pass.
import { z } from 'zod';
import { defineKind, snowflake, type Problem } from './types.js';

/** Discord's cap on channels in one category. */
export const CATEGORY_CHANNEL_LIMIT = 50;

export const personalRoomConfig = z.object({ categoryId: snowflake.nullable() });
export type PersonalRoomConfig = z.infer<typeof personalRoomConfig>;

async function categoryProblems(categoryId: string | null, check: (id: string) => Promise<{ missing: string[]; channelCount: number }>): Promise<Problem[]> {
  if (!categoryId) return [{ code: 'no_category' }];
  const state = await check(categoryId);
  if (state.missing.includes('NotFound')) return [{ code: 'category_missing' }];
  const problems: Problem[] = [];
  if (state.missing.length > 0) problems.push({ code: 'category_perms', missing: state.missing });
  if (state.channelCount >= CATEGORY_CHANNEL_LIMIT) problems.push({ code: 'category_full' });
  return problems;
}

export const personalRoomKind = defineKind<PersonalRoomConfig>({
  configSchema: personalRoomConfig,
  settable: ['categoryId'],
  sharedResource: false,

  async validate(good, env) {
    return { problems: await categoryProblems(good.config.categoryId, (id) => env.gateway.checkRoomCategory(id)), warnings: [] };
  },

  precheck: (good, env) => categoryProblems(good.config.categoryId, (id) => env.gateway.checkRoomCategory(id)),

  async apply(grant, good, env) {
    const room = grant.room;
    if (!room) throw new Error(`purchase ${grant.purchaseId}: a personal_room grant without a room row`);
    const categoryId = good.config.categoryId;
    if (!categoryId) throw new Error(`good ${good.id}: no room category chosen`);
    // Member overwrites only for people on the server (decision 010 (b) is still unmeasured).
    const present = await env.gateway.presentMembers([room.ownerId, ...room.guestIds]);
    const channelId = await env.gateway.ensureRoomChannel({
      categoryId,
      currentId: room.channelId,
      name: room.name,
      userLimit: room.userLimit,
      locked: room.locked,
      allowUserIds: [room.ownerId, ...room.guestIds].filter((id) => present.has(id)),
      claimedIds: await env.claimedRoomChannels(room.id),
    });
    if (channelId !== room.channelId) await env.saveRoomChannel(room.id, channelId);
    return 'applied';
  },

  async revoke(grant, _good, env) {
    if (grant.room?.channelId) await env.gateway.deleteChannel(grant.room.channelId);
  },

  describe() {
    return 'Свой голосовой канал: ты решаешь, кто заходит, как он называется и сколько мест';
  },
});
