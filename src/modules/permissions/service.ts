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
  /** True when the member holds any of the capabilities. */
  canAny(member: MemberFacts, capabilities: readonly CapabilityName[]): Promise<boolean>;
  /** The match's creator, or a holder of MATCH_MANAGE_ANY (decision 008 §6, Q5 meanwhile). */
  canManageMatch(member: MemberFacts, match: { createdById: string }): Promise<boolean>;
  /** Role ids granted a capability — voice overwrites for organisers (decision 008 §7). */
  rolesWith(capability: CapabilityName): Promise<string[]>;
}

/** Loads the capabilities granted to any of the given roles. */
export type CapabilitySource = (roleIds: readonly string[]) => Promise<CapabilityName[]>;
/** Loads the roles granted one capability. */
export type RoleSource = (capability: CapabilityName) => Promise<string[]>;

export function createPermissionsService(source: CapabilitySource, roles: RoleSource = () => Promise.resolve([])): PermissionsService {
  const canAny = async (member: MemberFacts, capabilities: readonly CapabilityName[]) => {
    if (member.isGuildOwner || member.isAdministrator) return true;
    if (member.roleIds.length === 0) return false;
    const held = await source(member.roleIds);
    return capabilities.some((c) => held.includes(c));
  };
  return {
    can: (member, capability) => canAny(member, [capability]),
    canAny,
    async canManageMatch(member, match) {
      if (member.userId === match.createdById) return true;
      return canAny(member, [Capability.MATCH_MANAGE_ANY]);
    },
    rolesWith: (capability) => roles(capability),
  };
}

export function dbCapabilitySource(db: Db): CapabilitySource {
  return async (roleIds) => {
    const rows = await db.roleCapability.findMany({ where: { roleId: { in: [...roleIds] } }, select: { capability: true } });
    return rows.map((r) => r.capability);
  };
}

export function dbRoleSource(db: Db): RoleSource {
  return async (capability) => {
    const rows = await db.roleCapability.findMany({ where: { capability }, select: { roleId: true }, orderBy: { roleId: 'asc' } });
    return rows.map((r) => r.roleId);
  };
}
