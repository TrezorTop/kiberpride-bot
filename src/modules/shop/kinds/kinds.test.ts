// The kind handlers against the fake gateway (decision 014 §3, 015): validate repairs Discord and
// stores ids once, precheck refuses before money, a clan converges its members.
import { describe, expect, it } from 'vitest';
import { FakeGateway } from '../../../../tests/fakes/gateway.js';
import { DEFAULT_CLAN_PALETTE } from './clanRole.js';
import { bindKind, guildIdsPatch, kinds, type GoodRecord, type KindEnv } from './index.js';

const CH = '700000000000000001';
const ANCHOR = '700000000000000020';

function env(gateway: FakeGateway, saved: Record<string, unknown>[] = []): KindEnv {
  return {
    gateway,
    saveGoodConfig: (_id, patch) => (saved.push(patch), Promise.resolve()),
    saveClanRole: () => Promise.resolve(),
    saveRoomChannel: () => Promise.resolve(),
    claimedRoomChannels: () => Promise.resolve([]),
  };
}

const good = (kind: string, config: unknown): GoodRecord => ({ id: 1, slug: kind, name: 'Доступ к картинкам и GIF', description: '', price: 5000, kind, config, validityDays: 30, enabled: true });

describe('channel_permission', () => {
  it('validate creates the role once, stores its id, writes the overwrites and warns about other roles', async () => {
    const gw = new FakeGateway();
    gw.accessChannels.set(CH, { everyoneHas: true, otherRoleIds: ['800000000000000001'], missing: [] });
    const saved: Record<string, unknown>[] = [];
    const bound = bindKind(good('channel_permission', { permissions: ['AttachFiles', 'EmbedLinks'], channelIds: [CH], roleId: null }));
    const result = await bound?.validate(env(gw, saved));
    expect(result?.problems).toEqual([]);
    expect(result?.warnings).toEqual([{ code: 'other_role_allows', channelId: CH, roleIds: ['800000000000000001'] }]);
    const roleId = saved[0]?.roleId as string;
    expect(gw.accessOverwrites.get(CH)).toEqual({ roleId, permissions: ['AttachFiles', 'EmbedLinks'] });

    // A replay after a crash before the id was stored adopts the role by its name.
    await bindKind(good('channel_permission', { permissions: ['AttachFiles'], channelIds: [CH], roleId: null }))?.validate(env(gw, saved));
    expect(gw.roleCreates).toHaveLength(1);
  });

  it('precheck refuses a missing role, no channels, a missing channel and a channel where everyone already may', async () => {
    const gw = new FakeGateway();
    const check = (config: unknown) => bindKind(good('channel_permission', config))?.precheck(env(gw));
    expect(await check({ permissions: ['AttachFiles'], channelIds: [], roleId: null })).toEqual([{ code: 'role_missing' }]);
    const roleId = await gw.ensureRole({ currentId: null, name: 'r', color: 0, restyle: false, adoptByName: false, belowRoleId: null, reason: '' });
    gw.accessChannels.set(CH, { everyoneHas: true, otherRoleIds: [], missing: [] });
    expect((await check({ permissions: ['AttachFiles'], channelIds: [CH, '700000000000000099'], roleId }))?.map((p) => p.code)).toEqual(['everyone_has', 'channel_missing']);
    expect((await check({ permissions: ['AttachFiles'], channelIds: [], roleId }))?.map((p) => p.code)).toEqual(['no_channels']);
    gw.canManageRoles = false;
    expect(await check({ permissions: ['AttachFiles'], channelIds: [CH], roleId })).toEqual([{ code: 'no_manage_roles' }]);
  });

  it('a config its schema refuses binds to nothing', () => {
    expect(bindKind(good('channel_permission', { permissions: [], channelIds: [], roleId: null }))).toBeNull();
    expect(bindKind(good('no_such_kind', {}))).toBeNull();
  });
});

describe('clan_role', () => {
  const config = (anchorRoleId: string | null) => ({ maxMembers: 10, forbiddenWords: [], palette: DEFAULT_CLAN_PALETTE, anchorRoleId });

  it('validate: no anchor, an anchor above the bot, too many roles', async () => {
    const gw = new FakeGateway();
    const problems = async (anchor: string | null) => (await bindKind(good('clan_role', config(anchor)))?.validate(env(gw)))?.problems.map((p) => p.code);
    expect(await problems(null)).toEqual(['anchor_missing']);
    expect(await problems(ANCHOR)).toEqual(['anchor_gone']);
    gw.extraRoles.add(ANCHOR);
    gw.rolesAboveBot.add(ANCHOR);
    expect(await problems(ANCHOR)).toEqual(['anchor_above_bot']);
    gw.rolesAboveBot.clear();
    gw.serverRoleNames = Array.from({ length: 250 }, (_, i) => `r${i}`);
    expect(await problems(ANCHOR)).toEqual(['too_many_roles']);
  });

  it('apply converges the role members to {owner} ∪ members, skipping fake ids', async () => {
    const gw = new FakeGateway();
    const owner = '300000000000000001';
    const stranger = '300000000000000003';
    const member = '300000000000000002';
    const bound = bindKind(good('clan_role', config(ANCHOR)));
    const grant = { purchaseId: 1, userId: owner, goodId: 1, room: null, clan: { id: 1, name: 'Волки', color: 1, roleId: null, ownerId: owner, memberIds: [member, '00000000000000001'] } };
    await bound?.apply(grant, env(gw));
    const roleId = gw.roleCreates[0] ?? '';
    await gw.setMemberRole(stranger, roleId, true); // someone gave the role by hand
    await bound?.apply({ ...grant, clan: { ...grant.clan, roleId } }, env(gw));
    expect((await gw.roleMembers(roleId)).sort()).toEqual([owner, member]);
    expect(gw.roles.get(roleId)?.below).toBe(ANCHOR);
  });
});

// The ids a good holds are ids of ONE guild; moving the bot invalidates all of them at once
// (src/modules/settings/guildChange.ts).
describe('guildIdsPatch', () => {
  it('empties the id lists and nulls the single ids, naming nothing else', () => {
    expect(guildIdsPatch('channel_permission', { permissions: ['AttachFiles'], channelIds: [CH], roleId: ANCHOR })).toEqual({
      channelIds: [],
      roleId: null,
    });
    expect(guildIdsPatch('clan_role', { maxMembers: 10, anchorRoleId: ANCHOR, palette: DEFAULT_CLAN_PALETTE })).toEqual({ anchorRoleId: null });
    expect(guildIdsPatch('personal_room', { categoryId: CH })).toEqual({ categoryId: null });
  });

  it('is a no-op for a good that holds no id, an unknown kind or a config that is not an object', () => {
    expect(guildIdsPatch('channel_permission', { permissions: ['AttachFiles'], channelIds: [], roleId: null })).toBeNull();
    expect(guildIdsPatch('personal_room', { categoryId: null })).toBeNull();
    expect(guildIdsPatch('no_such_kind', { categoryId: CH })).toBeNull();
    expect(guildIdsPatch('personal_room', null)).toBeNull();
    expect(guildIdsPatch('personal_room', [CH])).toBeNull();
  });

  it('clears a config its own schema would refuse — a broken good must not keep stale ids', () => {
    expect(bindKind(good('personal_room', { categoryId: CH, extra: 1, userLimit: 'no' }))).not.toBeNull();
    expect(guildIdsPatch('personal_room', { categoryId: CH, permissions: 'nonsense' })).toEqual({ categoryId: null });
  });

  it('every kind declares where its Discord ids are: a new kind cannot forget to', () => {
    for (const [name, kind] of Object.entries(kinds)) {
      expect(kind.guildIdKeys.length, `${name} declares no guildIdKeys`).toBeGreaterThan(0);
    }
  });
});
