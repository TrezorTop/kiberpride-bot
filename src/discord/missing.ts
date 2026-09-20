// One rule for «the stored Discord id is not there»: the id may be deleted, unreachable, or —
// after the bot was moved from the test guild to the real one (2026-09-20) — belong to a guild
// this deployment no longer serves. All three must end in the same place as a deleted channel:
// forget the id and create or choose again (decision 008 §7 ensure-by-id-then-name).
//
// 50001 is what a stale guild actually produced: `guild.channels.fetch(<other guild's id>)`
// answered «Missing Access», which is indistinguishable, from here, from «not there».
import { DiscordAPIError, DiscordjsError, DiscordjsErrorCodes, RESTJSONErrorCodes } from 'discord.js';

/**
 * Codes that mean «this id resolves to nothing this bot may use here».
 *
 * 50013 «Missing Permissions» is deliberately NOT here (architect's ruling, 2026-09-20): it means
 * the object exists and is visible and the bot lacks a permission on it. Counting that as absent
 * would make a delete forget the id and leak a channel in the guild we DO serve, silently and
 * unrecoverably — and a read would re-create something that already exists. A guild the bot is
 * not a member of answers 50001, not 50013, so the stale-guild case needs no such tolerance.
 */
const MISSING_CODES: readonly (number | string)[] = [
  RESTJSONErrorCodes.UnknownChannel, // 10003
  RESTJSONErrorCodes.UnknownGuild, // 10004
  RESTJSONErrorCodes.UnknownRole, // 10011
  RESTJSONErrorCodes.MissingAccess, // 50001 — what the stale guild actually returned
];

export function isMissing(err: unknown): boolean {
  // discord.js checks the guild itself before it ever reaches the network: when the bot IS still
  // in the other guild, `GuildChannelManager.fetch` gets the channel and throws its own
  // `GuildChannelUnowned` instead of a 50001 (review 2026-09-20). Same meaning, different class —
  // without this case a foreign id only looks absent after the bot has LEFT the other guild.
  if (err instanceof DiscordjsError) return err.code === DiscordjsErrorCodes.GuildChannelUnowned;
  return err instanceof DiscordAPIError && MISSING_CODES.includes(err.code);
}

/**
 * Does this channel / role / member belong to the guild this deployment serves? discord.js puts
 * the guild on `guildId` (channels) or on `guild.id` (roles); anything without either is treated
 * as foreign, which costs at most one re-creation and never keeps a stale id alive.
 *
 * Still needed where the object arrives WITHOUT a fetch that could throw: `roleById`'s
 * `guild.roles.cache.get(id)` hit, the fake gateway's own channel map (`tests/fakes/gateway.ts`),
 * and any collection walked in memory. After a `guild.channels.fetch(id)` it is a cheap belt:
 * that path is covered by `isMissing` above.
 */
export function belongsToGuild(entity: unknown, guildId: string): boolean {
  if (entity === null || typeof entity !== 'object') return false;
  const found = (entity as { guildId?: unknown }).guildId;
  if (typeof found === 'string') return found === guildId;
  const nested = (entity as { guild?: { id?: unknown } | null }).guild;
  return typeof nested?.id === 'string' && nested.id === guildId;
}
