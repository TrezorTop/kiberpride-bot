// Clans (decisions 014 §3.2, 015 §3–§4): the name rules, one clan per person, seats under
// concurrency, the role below the anchor, rename, expiry and a member leaving the server.
import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers.js';
import { ANCHOR_ROLE, buyer, codes, DAY, expectShopInvariants, fund, shopHarness, type ShopHarness } from './harness.js';

const OWNER = buyer(1);
const RED = 0; // palette index of «Красный»

async function buyClan(h: ShopHarness, owner: string, name: string, colorIndex = RED) {
  await fund(h, owner, 15_000, `clan-${name}`);
  return h.shop.buy(owner, h.goods.clan, 0, { clan: { name, colorIndex } });
}

async function clanRole(ownerId: string): Promise<string | null> {
  return (await testDb().clan.findFirstOrThrow({ where: { ownerId, closedAt: null } })).roleId;
}

describe('buying a clan', () => {
  it('creates the clan and its role — named, coloured, directly below the anchor — and gives it to the owner', async () => {
    const h = await shopHarness();
    const r = await buyClan(h, OWNER, '  Ночные   волки 🐺 ');
    expect(r.applied).toBe(true);
    const clan = await testDb().clan.findFirstOrThrow({ where: { ownerId: OWNER } });
    expect(clan).toMatchObject({ name: 'Ночные волки 🐺', color: 0xe74c3c, memberCount: 0 });
    const role = h.gateway.roles.get(clan.roleId ?? '');
    expect(role).toMatchObject({ name: 'Ночные волки 🐺', color: 0xe74c3c, below: ANCHOR_ROLE });
    expect(h.gateway.holds(OWNER, clan.roleId)).toBe(true);
    await expectShopInvariants();
  });

  it('refuses a bad name before any money moves', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 15_000);
    for (const [name, reason] of [
      ['A', 'length'],
      ['@everyone', 'chars'],
      ['discord.gg invite', 'link'],
      ['Модераторы', 'forbidden'],
      ['модератор', 'role_taken'],
    ] as const) {
      await expect(h.shop.buy(OWNER, h.goods.clan, 0, { clan: { name, colorIndex: RED } })).rejects.toMatchObject({
        code: 'NAME_INVALID',
        params: { reason },
      });
    }
    expect(await testDb().purchase.count()).toBe(0);
    await expectShopInvariants();
  });

  it('two open clans never share a name, whatever the case — the second buyer pays nothing', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 15_000);
    await fund(h, buyer(2), 15_000);
    // At the same moment neither role exists yet, so only the partial unique index can refuse.
    const settled = await Promise.allSettled([
      h.shop.buy(OWNER, h.goods.clan, 0, { clan: { name: 'Волки', colorIndex: RED } }),
      h.shop.buy(buyer(2), h.goods.clan, 0, { clan: { name: 'ВОЛКИ', colorIndex: RED } }),
    ]);
    expect(codes(settled).sort()).toEqual(['NAME_TAKEN', null]);
    expect(await testDb().purchase.count()).toBe(1);
    await h.shop.idle();
    const winner = settled[0].status === 'fulfilled' ? OWNER : buyer(2);
    const loser = winner === OWNER ? buyer(2) : OWNER;
    // Later, the role itself carries the name: refused before the database is asked.
    await expect(h.shop.buy(loser, h.goods.clan, 0, { clan: { name: 'волки', colorIndex: RED } })).rejects.toMatchObject({
      code: 'NAME_INVALID',
      params: { reason: 'role_taken' },
    });

    // Once the first clan ends, the name is free again.
    h.clock.advance(30 * DAY);
    await h.shop.expirePass(h.clock.now());
    await h.shop.idle();
    const again = await h.shop.buy(loser, h.goods.clan, 0, { clan: { name: 'ВОЛКИ', colorIndex: RED } });
    expect(again.applied).toBe(true);
    await expectShopInvariants();
  });
});

describe('members (Q15: the buyer plus up to maxMembers, one clan per person)', () => {
  it('ten concurrent adds into three free seats: exactly three members, the counter equals the rows', async () => {
    const h = await shopHarness({ maxMembers: 3 });
    await buyClan(h, OWNER, 'Трое');
    const candidates = Array.from({ length: 10 }, (_, i) => buyer(10 + i));
    const results = await Promise.all(candidates.map((u) => h.clans.addMembers(OWNER, [u])));
    await h.shop.idle();

    expect(results.flatMap((r) => r.added)).toHaveLength(3);
    expect(results.flatMap((r) => r.refused.map((x) => x.code)).every((c) => c === 'CLAN_FULL')).toBe(true);
    const clan = await testDb().clan.findFirstOrThrow({ where: { ownerId: OWNER } });
    expect(clan.memberCount).toBe(3);
    const role = clan.roleId;
    for (const u of results.flatMap((r) => r.added)) expect(h.gateway.holds(u, role)).toBe(true);
    await expectShopInvariants();
  });

  it('a player can be in one clan only; an owner cannot join another; a member cannot buy a clan', async () => {
    const h = await shopHarness();
    const other = buyer(2);
    const member = buyer(3);
    await buyClan(h, OWNER, 'Альфа');
    await buyClan(h, other, 'Бета');
    expect((await h.clans.addMembers(OWNER, [member])).added).toEqual([member]);

    expect((await h.clans.addMembers(other, [member])).refused).toEqual([{ userId: member, code: 'IN_OTHER_CLAN' }]);
    expect((await h.clans.addMembers(OWNER, [other])).refused).toEqual([{ userId: other, code: 'IN_OTHER_CLAN' }]);
    expect((await h.clans.addMembers(OWNER, [OWNER])).refused).toEqual([{ userId: OWNER, code: 'INVALID_TARGET' }]);
    await fund(h, member, 15_000);
    await expect(h.shop.buy(member, h.goods.clan, 0, { clan: { name: 'Гамма', colorIndex: RED } })).rejects.toMatchObject({ code: 'IN_OTHER_CLAN' });
    await expectShopInvariants();
  });

  it('«X is added to a clan» racing «X buys a clan»: never both', async () => {
    for (let round = 0; round < 5; round++) {
      const h = await shopHarness();
      const x = buyer(50 + round);
      await buyClan(h, OWNER, `Клан ${round}`);
      await fund(h, x, 15_000);
      const [added, bought] = await Promise.allSettled([
        h.clans.addMembers(OWNER, [x]),
        h.shop.buy(x, h.goods.clan, 0, { clan: { name: `Свой ${round}`, colorIndex: RED } }),
      ]);
      await h.shop.idle();
      const isMember = (await testDb().clanMember.count({ where: { userId: x } })) === 1;
      const owns = (await testDb().clan.count({ where: { ownerId: x, closedAt: null } })) === 1;
      expect(isMember && owns).toBe(false);
      expect(isMember || owns).toBe(true);
      if (bought.status === 'rejected') expect((bought.reason as { code?: string }).code).toBe('IN_OTHER_CLAN');
      if (added.status === 'fulfilled' && added.value.added.length === 0) expect(added.value.refused[0]?.code).toBe('IN_OTHER_CLAN');
      await expectShopInvariants();
      await testDb().$executeRawUnsafe('TRUNCATE "KpTransaction", "Purchase", "ShopGood", "User", "Clan", "ClanMember", "PersonalRoom", "RoomGuest" RESTART IDENTITY CASCADE');
    }
  });

  it('remove and leave take the role back and free the seat', async () => {
    const h = await shopHarness();
    const [a, b] = [buyer(2), buyer(3)];
    await buyClan(h, OWNER, 'Дельта');
    await h.clans.addMembers(OWNER, [a, b]);
    await h.shop.idle();
    const role = await clanRole(OWNER);

    await h.clans.removeMember(OWNER, a);
    await h.clans.leave(b);
    await h.shop.idle();
    expect(h.gateway.holds(a, role)).toBe(false);
    expect(h.gateway.holds(b, role)).toBe(false);
    expect(h.gateway.holds(OWNER, role)).toBe(true);
    expect((await testDb().clan.findFirstOrThrow({ where: { ownerId: OWNER } })).memberCount).toBe(0);
    await expect(h.clans.removeMember(OWNER, a)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expect(h.clans.leave(OWNER)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expectShopInvariants();
  });

  it('a member who leaves the server frees the seat; an owner who leaves keeps the clan', async () => {
    const h = await shopHarness();
    const a = buyer(2);
    await buyClan(h, OWNER, 'Эпсилон');
    await h.clans.addMembers(OWNER, [a]);
    await h.shop.memberLeft(a);
    await h.shop.memberLeft(OWNER);
    await h.shop.idle();
    const clan = await testDb().clan.findFirstOrThrow({ where: { ownerId: OWNER } });
    expect(clan).toMatchObject({ memberCount: 0, closedAt: null });
    expect(h.logging.events.find((e) => e.name === 'shop.member_left')?.audit).toMatch(/освободилось/);
    await expectShopInvariants();
  });
});

describe('rename, convergence and expiry', () => {
  it('the owner’s rename writes name and colour; convergence never reverts a moderator’s rename', async () => {
    const h = await shopHarness();
    await buyClan(h, OWNER, 'Старое');
    const role = (await clanRole(OWNER)) ?? '';
    await expect(h.clans.restyle(OWNER, { name: 'админы', colorIndex: 1 })).rejects.toMatchObject({ code: 'NAME_INVALID' });
    const view = await h.clans.restyle(OWNER, { name: 'Новое', colorIndex: 1 });
    expect(view).toMatchObject({ name: 'Новое', colorLabel: 'Оранжевый' });
    expect(h.gateway.roles.get(role)).toMatchObject({ name: 'Новое', color: 0xe67e22, below: ANCHOR_ROLE });

    const fakeRole = h.gateway.roles.get(role);
    if (fakeRole) fakeRole.name = 'Переименовал модератор';
    await h.shop.reconcile(OWNER, h.goods.clan);
    expect(h.gateway.roles.get(role)?.name).toBe('Переименовал модератор');
    await expectShopInvariants();
  });

  it('expiry closes the clan, frees its members and deletes the role; a renewal keeps everything', async () => {
    const h = await shopHarness();
    const a = buyer(2);
    await fund(h, OWNER, 15_000, 'renew');
    await buyClan(h, OWNER, 'Живучие');
    await h.clans.addMembers(OWNER, [a]);
    await h.shop.idle();
    const role = await clanRole(OWNER);

    await h.shop.buy(OWNER, h.goods.clan, 1); // renewal: same clan, same role
    expect(await clanRole(OWNER)).toBe(role);
    h.clock.advance(60 * DAY);
    await h.shop.expirePass(h.clock.now());
    await h.shop.idle();

    const clan = await testDb().clan.findFirstOrThrow({ where: { ownerId: OWNER } });
    expect(clan.closedAt).not.toBeNull();
    expect(await testDb().clanMember.count()).toBe(0);
    expect(h.gateway.roleDeletes).toContain(role);
    expect(h.gateway.holds(a, role)).toBe(false);
    await expectShopInvariants();
  });

  it('a role that cannot be positioned is created once, and the refund deletes it (017 §1)', async () => {
    const h = await shopHarness({ applyWaitMs: 50 });
    h.gateway.failPlacement = true;
    h.gateway.failRoleOps = true; // the passes after the failed placement keep failing too
    const before = h.gateway.roleCreates.length; // the media good's role, made by the harness
    const r = await buyClan(h, OWNER, 'Упрямые');
    await h.shop.idle();
    expect(r.applied).toBe(false);
    await h.shop.reconcile(OWNER, h.goods.clan);
    await h.shop.reconcile(OWNER, h.goods.clan); // three failing passes in all, the buy's own first
    const created = h.gateway.roleCreates.slice(before);
    expect(created).toHaveLength(1);
    const role = created[0];
    expect(await clanRole(OWNER)).toBe(role);

    h.clock.advance(31 * 60_000);
    await h.shop.reconcile(OWNER, h.goods.clan);
    await h.shop.idle();
    expect((await testDb().purchase.findUniqueOrThrow({ where: { id: r.purchaseId } })).status).toBe('REFUNDED');
    expect(h.gateway.roleCreates.slice(before)).toEqual([role]);
    expect(h.gateway.roleDeletes).toEqual([role]);
    await expectShopInvariants();
  });

  it('a rename after the role was deleted in Discord leaves creation to convergence: one new role, saved (017 §1)', async () => {
    const h = await shopHarness();
    await buyClan(h, OWNER, 'Пропавшие');
    const old = (await clanRole(OWNER)) ?? '';
    await h.gateway.deleteRole(old); // a moderator deleted it
    const before = h.gateway.roleCreates.length;
    await h.clans.restyle(OWNER, { name: 'Вернувшиеся', colorIndex: 1 });
    await h.shop.idle();
    expect(h.gateway.roleCreates.slice(before)).toHaveLength(1);
    const now = await clanRole(OWNER);
    expect(now).not.toBe(old);
    expect(h.gateway.roles.get(now ?? '')).toMatchObject({ name: 'Вернувшиеся', color: 0xe67e22, below: ANCHOR_ROLE });
    expect(h.gateway.holds(OWNER, now)).toBe(true);
    await expectShopInvariants();
  });

  it('without an anchor role the clan good cannot be enabled (decision 015 §4)', async () => {
    const h = await shopHarness();
    const good = await testDb().shopGood.findUniqueOrThrow({ where: { id: h.goods.clan } });
    await testDb().shopGood.update({ where: { id: good.id }, data: { enabled: false, config: { ...(good.config as object), anchorRoleId: null } } });
    const admin = { userId: buyer(9), roleIds: [], isGuildOwner: true, isAdministrator: false };
    const refused = await h.shop.setEnabled(admin, good.id, true);
    expect(refused.enabled).toBe(false);
    expect(refused.problems.map((p) => p.code)).toEqual(['anchor_missing']);

    const configured = await h.shop.configure(admin, good.id, { anchorRoleId: ANCHOR_ROLE });
    expect(configured.problems).toEqual([]);
    expect((await h.shop.setEnabled(admin, good.id, true)).enabled).toBe(true);
    const stranger = { userId: buyer(8), roleIds: [], isGuildOwner: false, isAdministrator: false };
    const denied = await Promise.allSettled([h.shop.setEnabled(stranger, good.id, false), h.shop.configure(stranger, good.id, { anchorRoleId: null })]);
    expect(codes(denied)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
  });
});
