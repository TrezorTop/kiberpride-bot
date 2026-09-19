// The shop kind registry (decision 014 §3): a new kind of good is one file in this folder plus
// one line in `kinds`. At startup a good whose kind is unknown or whose config fails its schema
// is disabled and logged (002 §5).
import { channelPermissionKind } from './channelPermission.js';
import { clanRoleKind } from './clanRole.js';
import { personalRoomKind } from './personalRoom.js';
import type { BoundKind, GoodRecord, KindEntry } from './types.js';

export type * from './types.js';

export const kinds: Readonly<Record<string, KindEntry>> = {
  channel_permission: channelPermissionKind,
  clan_role: clanRoleKind,
  personal_room: personalRoomKind,
};

/** The handler for a good, or null for an unknown kind or a config its schema refuses. */
export function bindKind(good: GoodRecord): BoundKind | null {
  return Object.hasOwn(kinds, good.kind) ? (kinds[good.kind]?.bind(good) ?? null) : null;
}

/**
 * A config patch that forgets every Discord id of this good — a list becomes empty, a single id
 * null — or null when there is nothing to forget. Used only when the deployment changes guild
 * (src/modules/settings/guildChange.ts): the old guild's roles and channels do not exist here.
 * Runs on the raw config, because a good whose config no longer parses must be cleared too, and
 * it names only the cleared keys, so it merges over a concurrent settings save (014 §7).
 */
export function guildIdsPatch(kind: string, config: unknown): Record<string, unknown> | null {
  if (!Object.hasOwn(kinds, kind) || config === null || typeof config !== 'object' || Array.isArray(config)) return null;
  const current = config as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of kinds[kind]?.guildIdKeys ?? []) {
    const held = current[key];
    if (Array.isArray(held)) {
      if (held.length > 0) patch[key] = [];
    } else if (held !== null && held !== undefined) {
      patch[key] = null;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
