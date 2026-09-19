// Rights are checked in one place (spec «Roles on the server»). Which role may do what is data
// (RoleCapability rows), not code. The guild owner and any member with Discord's Administrator
// permission hold every capability implicitly, so a fresh server is never locked out.
import type { Db } from '../../db/client.js';
import { Capability } from '../../generated/prisma/enums.js';

export { Capability };
export type CapabilityName = (typeof Capability)[keyof typeof Capability];

/** What the Discord layer knows about the member pressing a button; no discord.js types. */
export interface MemberFacts {
  userId: string;
  roleIds: readonly string[];
  isGuildOwner: boolean;
  isAdministrator: boolean;
}

export interface PermissionsService {
  can(member: MemberFacts, capability: CapabilityName): Promise<boolean>;
}

/** Loads the capabilities granted to any of the given roles. */
export type CapabilitySource = (roleIds: readonly string[]) => Promise<CapabilityName[]>;

export function createPermissionsService(source: CapabilitySource): PermissionsService {
  return {
    async can(member, capability) {
      if (member.isGuildOwner || member.isAdministrator) return true;
      if (member.roleIds.length === 0) return false;
      return (await source(member.roleIds)).includes(capability);
    },
  };
}

export function dbCapabilitySource(db: Db): CapabilitySource {
  return async (roleIds) => {
    const rows = await db.roleCapability.findMany({ where: { roleId: { in: [...roleIds] } }, select: { capability: true } });
    return rows.map((r) => r.capability);
  };
}
