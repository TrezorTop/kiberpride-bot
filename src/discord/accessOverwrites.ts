// Overwrites of the access channels (decision 014 §3.1). These channels belong to the server, not
// to the bot, so every write is `permissionOverwrites.edit` of ONE target and ONE set of flags —
// never `set`, which replaces the whole list and would wipe the server's own overwrites. Kept
// apart from the gateway so a unit test can prove `set` is never reached.
import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import type { AccessPermission } from '../core/ports.js';

/** The slice of discord.js's PermissionOverwriteManager this file uses. */
export interface OverwritesLike {
  cache: ReadonlyMap<string, { id: string; type: OverwriteType; allow: { has(bit: bigint): boolean } }>;
  edit(target: string, options: Partial<Record<AccessPermission, boolean | null>>, extra: { type: OverwriteType; reason: string }): Promise<unknown>;
  delete(target: string, reason: string): Promise<unknown>;
}

export interface AccessTargets {
  everyoneId: string;
  botId: string;
  roleId: string;
}

const flags = (perms: readonly AccessPermission[], value: boolean | null) =>
  Object.fromEntries(perms.map((p) => [p, value])) as Partial<Record<AccessPermission, boolean | null>>;

/**
 * Order matters: Discord lets a bot allow or deny only permissions it holds in the channel. The
 * bot's own allow goes first, while it still holds them, and keeps them after @everyone is
 * denied — so the next run (and the bot's own embeds in that channel) still work.
 */
export async function writeAccessOverwrites(ow: OverwritesLike, t: AccessTargets, perms: readonly AccessPermission[], reason: string): Promise<void> {
  await ow.edit(t.botId, flags(perms, true), { type: OverwriteType.Member, reason });
  await ow.edit(t.roleId, flags(perms, true), { type: OverwriteType.Role, reason });
  await ow.edit(t.everyoneId, flags(perms, false), { type: OverwriteType.Role, reason });
}

/** A channel taken off the list: the role's overwrite deleted, @everyone and the bot back to inherit. */
export async function clearAccessOverwrites(
  ow: OverwritesLike,
  t: { everyoneId: string; botId: string; roleId: string | null },
  perms: readonly AccessPermission[],
  reason: string,
): Promise<void> {
  if (t.roleId && ow.cache.has(t.roleId)) await ow.delete(t.roleId, reason);
  if (ow.cache.has(t.everyoneId)) await ow.edit(t.everyoneId, flags(perms, null), { type: OverwriteType.Role, reason });
  if (ow.cache.has(t.botId)) await ow.edit(t.botId, flags(perms, null), { type: OverwriteType.Member, reason });
}

/** Other roles whose overwrite in the channel allows a granted permission (a warning only). */
export function otherRolesAllowing(ow: OverwritesLike, t: AccessTargets, perms: readonly AccessPermission[]): string[] {
  const bits = perms.map((p) => PermissionFlagsBits[p]);
  return [...ow.cache.values()]
    .filter((o) => o.type === OverwriteType.Role && o.id !== t.roleId && o.id !== t.everyoneId && bits.some((b) => o.allow.has(b)))
    .map((o) => o.id);
}
