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
