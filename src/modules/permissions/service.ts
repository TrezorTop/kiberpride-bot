// Rights are checked in one place (spec Â«Roles on the serverÂ»). Which role may do what is data
// (RoleCapability rows), not code. The guild owner and any member with Discord's Administrator
// permission hold every capability implicitly, so a fresh server is never locked out.
import { DomainError } from '../../core/errors.js';
import type { Db } from '../../db/client.js';
import { withTx } from '../../db/tx.js';
import { Capability } from '../../generated/prisma/enums.js';

export { Capability };
export type CapabilityName = (typeof Capability)[keyof typeof Capability];

/** Every capability, in the order the schema declares them â€” the order `/Ð¿Ñ€Ð°Ð²Ð°` shows. */
export const CAPABILITIES: readonly CapabilityName[] = Object.values(Capability);

/** At most this many roles may hold one capability â€” Discord's own select limit. */
export const MAX_ROLES_PER_CAPABILITY = 25;

/** What the Discord layer knows about the member pressing a button; no discord.js types. */
export interface MemberFacts {
  userId: string;
  roleIds: readonly string[];
  isGuildOwner: boolean;
  isAdministrator: boolean;
}

/** Capability â†’ the role ids that hold it; every capability is a key, `[]` means Â«Ð½Ðµ Ð·Ð°Ð´Ð°Ð½Ð¾Â». */
export type RightsMap = Record<CapabilityName, string[]>;

/** What one save changed, for the log line. */
export interface RightsChange {
  added: string[];
  removed: string[];
}

export interface PermissionsService {
  can(member: MemberFacts, capability: CapabilityName): Promise<boolean>;
  /** True when the member holds any of the capabilities. */
  canAny(member: MemberFacts, capabilities: readonly CapabilityName[]): Promise<boolean>;
  /** The match's creator, or a holder of MATCH_MANAGE_ANY (decision 008 Â§6, Q5 meanwhile). */
  canManageMatch(member: MemberFacts, match: { createdById: string }): Promise<boolean>;
  /** Role ids granted a capability â€” voice overwrites for organisers (decision 008 Â§7). */
  rolesWith(capability: CapabilityName): Promise<string[]>;
  /** The whole grant table, as the `/Ð¿Ñ€Ð°Ð²Ð°` screen shows it. */
  listRights(): Promise<RightsMap>;
  /** Replaces the roles holding one capability; needs SETTINGS_MANAGE. */
  setRoles(actor: MemberFacts, capability: CapabilityName, roleIds: readonly string[]): Promise<RightsChange>;
}

/** Loads the capabilities granted to any of the given roles. */
export type CapabilitySource = (roleIds: readonly string[]) => Promise<CapabilityName[]>;
/** Loads the roles granted one capability. */
export type RoleSource = (capability: CapabilityName) => Promise<string[]>;

/** Reads and writes the grant table; the db implementation is `dbRightsStore`. */
export interface RightsStore {
  list(): Promise<{ capability: CapabilityName; roleId: string }[]>;
  /** Makes the roles of one capability exactly `roleIds`, atomically. */
  replace(capability: CapabilityName, roleIds: readonly string[]): Promise<RightsChange>;
}

export interface PermissionsDeps {
  capabilities: CapabilitySource;
  roles?: RoleSource;
  rights: RightsStore;
  /** @everyone's role id is the guild id; null until the guild is known (src/main.ts). */
  everyoneRoleId?: () => string | null;
}

const SNOWFLAKE = /^\d{17,20}$/;

export function createPermissionsService(deps: PermissionsDeps): PermissionsService {
  const source = deps.capabilities;
  const roles = deps.roles ?? (() => Promise.resolve([]));
  const everyoneRoleId = deps.everyoneRoleId ?? (() => null);

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

    async listRights() {
      const rows = await deps.rights.list();
      const map = Object.fromEntries(CAPABILITIES.map((c) => [c, [] as string[]])) as RightsMap;
      for (const row of rows) map[row.capability]?.push(row.roleId);
      for (const c of CAPABILITIES) map[c].sort();
      return map;
    },

    async setRoles(actor, capability, roleIds) {
      if (!(await canAny(actor, [Capability.SETTINGS_MANAGE]))) throw new DomainError('NOT_ALLOWED', 'rights');
      if (!CAPABILITIES.includes(capability)) throw new DomainError('STALE_PANEL', `capability ${String(capability)}`);
      const wanted = [...new Set(roleIds)];
      if (wanted.length > MAX_ROLES_PER_CAPABILITY) throw new DomainError('STALE_PANEL', `${wanted.length} roles`);
      // A select's values come from the client and can be forged: @everyone would hand the right
      // to the whole server, so it is refused here as well as in the handler.
      const everyone = everyoneRoleId();
      for (const id of wanted) {
        if (!SNOWFLAKE.test(id)) throw new DomainError('STALE_PANEL', `role ${id}`);
        if (everyone !== null && id === everyone) throw new DomainError('ROLE_NOT_GRANTABLE', '@everyone');
      }
      return deps.rights.replace(capability, wanted);
    },
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

export function dbRightsStore(db: Db): RightsStore {
  return {
    async list() {
      return db.roleCapability.findMany({ select: { capability: true, roleId: true }, orderBy: [{ capability: 'asc' }, { roleId: 'asc' }] });
    },

    replace(capability, roleIds) {
      return withTx(db, async (tx) => {
        // Two admins saving the same capability at once must not leave a mixture of their two
        // sets: a delete cannot lock the rows the other side is about to insert, so the savers
        // are serialised by a lock on the capability itself. Last save wins, whole.
        // The lock call is wrapped: it returns `void`, which the client cannot deserialize.
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext('kp:rights'), hashtext(${capability}::text))) AS taken`;
        const before = (await tx.roleCapability.findMany({ where: { capability }, select: { roleId: true } })).map((r) => r.roleId);
        const wanted = new Set(roleIds);
        const removed = before.filter((id) => !wanted.has(id)).sort();
        const added = [...wanted].filter((id) => !before.includes(id)).sort();
        if (removed.length > 0) await tx.roleCapability.deleteMany({ where: { capability, roleId: { in: removed } } });
        if (added.length > 0) await tx.roleCapability.createMany({ data: added.map((roleId) => ({ roleId, capability })), skipDuplicates: true });
        return { added, removed };
      });
    },
  };
}

/** Every db-backed source in one object: `createPermissionsService({ ...dbPermissionSources(db) })`. */
export function dbPermissionSources(db: Db): { capabilities: CapabilitySource; roles: RoleSource; rights: RightsStore } {
  return { capabilities: dbCapabilitySource(db), roles: dbRoleSource(db), rights: dbRightsStore(db) };
}
