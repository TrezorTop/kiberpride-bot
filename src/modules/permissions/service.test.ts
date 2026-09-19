import { describe, expect, it, vi } from 'vitest';
import { createPermissionsService, type CapabilityName, type MemberFacts } from './service.js';

const member = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  userId: '100000000000000001',
  roleIds: [],
  isGuildOwner: false,
  isAdministrator: false,
  ...over,
});

function serviceWith(grants: Record<string, CapabilityName[]>) {
  const source = vi.fn((roleIds: readonly string[]) => Promise.resolve(roleIds.flatMap((r) => grants[r] ?? [])));
  return { service: createPermissionsService(source), source };
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
});
