// `/права` against the real table: a save replaces the whole set for one right, re-saving
// changes nothing, @everyone is refused, and two admins saving at once leave one of their two
// sets — never a mixture.
import { describe, expect, it } from 'vitest';
import { createPermissionsService, dbPermissionSources, type CapabilityName, type MemberFacts } from '../../../src/modules/permissions/service.js';
import { testDb } from '../helpers.js';

const GUILD = '900000000000000001'; // the guild id is also @everyone's role id
const ROLE_A = '600000000000000001';
const ROLE_B = '600000000000000002';
const ROLE_C = '600000000000000003';

const ADMIN: MemberFacts = { userId: '100000000000000009', roleIds: [], isGuildOwner: false, isAdministrator: true };
const PLAYER: MemberFacts = { userId: '100000000000000010', roleIds: [ROLE_A], isGuildOwner: false, isAdministrator: false };

function service() {
  return createPermissionsService({ ...dbPermissionSources(testDb()), everyoneRoleId: () => GUILD });
}

async function rolesOf(capability: CapabilityName): Promise<string[]> {
  const rows = await testDb().roleCapability.findMany({ where: { capability }, select: { roleId: true }, orderBy: { roleId: 'asc' } });
  return rows.map((r) => r.roleId);
}

describe('rights: setRoles', () => {
  it('replaces the whole set: the roles left out lose the right', async () => {
    const rights = service();
    expect(await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A, ROLE_B])).toEqual({ added: [ROLE_A, ROLE_B], removed: [] });
    expect(await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_B, ROLE_C])).toEqual({ added: [ROLE_C], removed: [ROLE_A] });
    expect(await rolesOf('ACTIVITY_CREATE')).toEqual([ROLE_B, ROLE_C]);
  });

  it('touches only the right that was saved', async () => {
    const rights = service();
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A]);
    await rights.setRoles(ADMIN, 'SHOP_MANAGE', [ROLE_B]);
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', []);
    expect(await rolesOf('ACTIVITY_CREATE')).toEqual([]);
    expect(await rolesOf('SHOP_MANAGE')).toEqual([ROLE_B]);
  });

  it('saving the same set again changes nothing and leaves one row per role', async () => {
    const rights = service();
    await rights.setRoles(ADMIN, 'MATCH_MANAGE_ANY', [ROLE_A, ROLE_B]);
    expect(await rights.setRoles(ADMIN, 'MATCH_MANAGE_ANY', [ROLE_B, ROLE_A])).toEqual({ added: [], removed: [] });
    expect(await testDb().roleCapability.count({ where: { capability: 'MATCH_MANAGE_ANY' } })).toBe(2);
  });

  it('a granted role really carries the right, a plain member does not', async () => {
    const rights = service();
    expect(await rights.can(PLAYER, 'ACTIVITY_CREATE')).toBe(false);
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A]);
    expect(await rights.can(PLAYER, 'ACTIVITY_CREATE')).toBe(true);
    expect(await rights.rolesWith('ACTIVITY_CREATE')).toEqual([ROLE_A]);
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', []);
    expect(await rights.can(PLAYER, 'ACTIVITY_CREATE')).toBe(false);
  });

  it('refuses @everyone and writes nothing at all', async () => {
    const rights = service();
    await expect(rights.setRoles(ADMIN, 'ECONOMY_ADMIN', [ROLE_A, GUILD])).rejects.toMatchObject({ code: 'ROLE_NOT_GRANTABLE' });
    expect(await rolesOf('ECONOMY_ADMIN')).toEqual([]);
  });

  it('refuses an actor without SETTINGS_MANAGE, even one who may create games', async () => {
    const rights = service();
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A]);
    await expect(rights.setRoles(PLAYER, 'SETTINGS_MANAGE', [ROLE_A])).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect(await rolesOf('SETTINGS_MANAGE')).toEqual([]);
  });

  it('lets a role granted SETTINGS_MANAGE hand out rights itself', async () => {
    const rights = service();
    await rights.setRoles(ADMIN, 'SETTINGS_MANAGE', [ROLE_A]);
    await rights.setRoles(PLAYER, 'SHOP_MANAGE', [ROLE_B]);
    expect(await rolesOf('SHOP_MANAGE')).toEqual([ROLE_B]);
  });

  it('two admins saving the same right at once leave one of their two sets, not a mixture', async () => {
    const rights = service();
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A, ROLE_B]);
    await Promise.all([rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A]), rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_C])]);
    expect([[ROLE_A], [ROLE_C]]).toContainEqual(await rolesOf('ACTIVITY_CREATE'));
  });

  it('ten concurrent saves of the same set leave exactly that set', async () => {
    const rights = service();
    await Promise.all(Array.from({ length: 10 }, () => rights.setRoles(ADMIN, 'SHOP_MANAGE', [ROLE_A, ROLE_B])));
    expect(await rolesOf('SHOP_MANAGE')).toEqual([ROLE_A, ROLE_B]);
  });

  it('listRights shows every right, with an empty set for the ones nobody holds', async () => {
    const rights = service();
    await rights.setRoles(ADMIN, 'ACTIVITY_CREATE', [ROLE_A]);
    const map = await rights.listRights();
    expect(map.ACTIVITY_CREATE).toEqual([ROLE_A]);
    expect(map.SETTINGS_MANAGE).toEqual([]);
    expect(map.ECONOMY_ADMIN).toEqual([]);
  });
});
