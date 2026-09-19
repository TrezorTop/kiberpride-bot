import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, createPermissionsService, type CapabilityName, type MemberFacts } from './service.js';

const member = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  userId: '100000000000000001',
  roleIds: [],
  isGuildOwner: false,
  isAdministrator: false,
  ...over,
});

/** The grant table in memory: the db-backed store has its own tests (tests/db/permissions). */
function memoryRights(initial: { capability: CapabilityName; roleId: string }[] = []) {
  let rows = [...initial];
  return {
    current: () => rows,
    list: () => Promise.resolve(rows.map((r) => ({ ...r }))),
    replace: vi.fn((capability: CapabilityName, roleIds: readonly string[]) => {
      const before = rows.filter((r) => r.capability === capability).map((r) => r.roleId);
      const removed = before.filter((id) => !roleIds.includes(id));
      const added = roleIds.filter((id) => !before.includes(id));
      rows = rows.filter((r) => r.capability !== capability || roleIds.includes(r.roleId));
      for (const roleId of added) rows.push({ capability, roleId });
      return Promise.resolve({ added: [...added], removed });
    }),
  };
}

function serviceWith(grants: Record<string, CapabilityName[]>, opts: { everyoneRoleId?: string; rows?: { capability: CapabilityName; roleId: string }[] } = {}) {
  const source = vi.fn((roleIds: readonly string[]) => Promise.resolve(roleIds.flatMap((r) => grants[r] ?? [])));
  const rights = memoryRights(opts.rows);
  const service = createPermissionsService({
    capabilities: source,
    rights,
    everyoneRoleId: () => opts.everyoneRoleId ?? null,
  });
  return { service, source, rights };
}

describe('permissions', () => {
  it('gives the guild owner every capability without any role', async () => {
    const { service, source } = serviceWith({});
    expect(await service.can(member({ isGuildOwner: true }), 'SETTINGS_MANAGE')).toBe(true);
    expect(await service.can(member({ isGuildOwner: true }), 'ECONOMY_ADMIN')).toBe(true);
    expect(source).not.toHaveBeenCalled();
  });

  it('gives a Discord Administrator every capability without any role', async () => {
    const { service } = serviceWith({});
    expect(await service.can(member({ isAdministrator: true }), 'MATCH_MANAGE_ANY')).toBe(true);
  });

  it('refuses a plain member with no roles', async () => {
    const { service } = serviceWith({ '200000000000000001': ['ACTIVITY_CREATE'] });
    expect(await service.can(member(), 'ACTIVITY_CREATE')).toBe(false);
  });

  describe('canManageMatch', () => {
    const creator = '100000000000000001';
    const manager = '200000000000000009';

    it('lets the creator manage their own match with no role at all', async () => {
      const { service } = serviceWith({});
      expect(await service.canManageMatch(member({ userId: creator }), { createdById: creator })).toBe(true);
    });

    it('lets a MATCH_MANAGE_ANY holder manage anyone’s match', async () => {
      const { service } = serviceWith({ [manager]: ['MATCH_MANAGE_ANY'] });
      const m = member({ userId: '100000000000000002', roleIds: [manager] });
      expect(await service.canManageMatch(m, { createdById: creator })).toBe(true);
    });

    it('refuses another organiser who only may create activities', async () => {
      const { service } = serviceWith({ [manager]: ['ACTIVITY_CREATE'] });
      const m = member({ userId: '100000000000000002', roleIds: [manager] });
      expect(await service.canManageMatch(m, { createdById: creator })).toBe(false);
    });

    it('lets the guild owner and administrators manage any match', async () => {
      const { service } = serviceWith({});
      expect(await service.canManageMatch(member({ userId: '9'.repeat(18), isGuildOwner: true }), { createdById: creator })).toBe(true);
      expect(await service.canManageMatch(member({ userId: '9'.repeat(18), isAdministrator: true }), { createdById: creator })).toBe(true);
    });
  });

  it('canAny passes when any one capability is held', async () => {
    const organiser = '200000000000000001';
    const { service } = serviceWith({ [organiser]: ['SETTINGS_MANAGE'] });
    const m = member({ roleIds: [organiser] });
    expect(await service.canAny(m, ['ACTIVITY_CREATE', 'SETTINGS_MANAGE'])).toBe(true);
    expect(await service.canAny(m, ['ACTIVITY_CREATE', 'MATCH_MANAGE_ANY'])).toBe(false);
  });

  it('grants exactly what the member’s roles carry', async () => {
    const organiser = '200000000000000001';
    const { service } = serviceWith({ [organiser]: ['ACTIVITY_CREATE'] });
    const m = member({ roleIds: ['299999999999999999', organiser] });
    expect(await service.can(m, 'ACTIVITY_CREATE')).toBe(true);
    expect(await service.can(m, 'MATCH_MANAGE_ANY')).toBe(false);
  });

  describe('/права', () => {
    const admin = member({ isAdministrator: true });
    const role = '200000000000000005';

    it('lists every capability, with an empty set for the ones nobody holds', async () => {
      const { service } = serviceWith({}, { rows: [{ capability: 'ACTIVITY_CREATE', roleId: role }] });
      const rights = await service.listRights();
      expect(Object.keys(rights).sort()).toEqual([...CAPABILITIES].sort());
      expect(rights.ACTIVITY_CREATE).toEqual([role]);
      expect(rights.SHOP_MANAGE).toEqual([]);
    });

    it('refuses a member without SETTINGS_MANAGE, and writes nothing', async () => {
      const { service, rights } = serviceWith({});
      await expect(service.setRoles(member(), 'ACTIVITY_CREATE', [role])).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
      expect(rights.replace).not.toHaveBeenCalled();
    });

    it('refuses @everyone even when the select says otherwise', async () => {
      const guildId = '999000000000000001';
      const { service, rights } = serviceWith({}, { everyoneRoleId: guildId });
      await expect(service.setRoles(admin, 'ACTIVITY_CREATE', [role, guildId])).rejects.toMatchObject({ code: 'ROLE_NOT_GRANTABLE' });
      expect(rights.replace).not.toHaveBeenCalled();
    });

    it('refuses a forged capability and a forged role id', async () => {
      const { service, rights } = serviceWith({});
      await expect(service.setRoles(admin, 'NOT_A_RIGHT' as CapabilityName, [role])).rejects.toMatchObject({ code: 'STALE_PANEL' });
      await expect(service.setRoles(admin, 'ACTIVITY_CREATE', ['not-a-snowflake'])).rejects.toMatchObject({ code: 'STALE_PANEL' });
      expect(rights.replace).not.toHaveBeenCalled();
    });

    it('saves the picked roles once each, and can clear a right entirely', async () => {
      const { service, rights } = serviceWith({}, { rows: [{ capability: 'ACTIVITY_CREATE', roleId: role }] });
      const other = '200000000000000006';
      expect(await service.setRoles(admin, 'ACTIVITY_CREATE', [other, other])).toEqual({ added: [other], removed: [role] });
      expect(await service.setRoles(admin, 'ACTIVITY_CREATE', [])).toEqual({ added: [], removed: [other] });
      expect(rights.current()).toEqual([]);
    });
  });
});
