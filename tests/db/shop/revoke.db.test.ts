// `/отозвать` (decision 023): an administrator ends a purchase by hand, with or without giving
// the KP Coin back. The guards that matter: the grant really ends (through the same convergence
// as expiry), the money goes back at most once, a stale panel changes nothing, and a player
// without SHOP_MANAGE changes nothing.
import { describe, expect, it } from 'vitest';
import type { MemberFacts } from '../../../src/modules/permissions/service.js';
import { testDb } from '../helpers.js';
import { ADMIN, balanceOf, buyer, codes, expectShopInvariants, fund, mediaRoleId, shopHarness } from './harness.js';

const U = buyer(1);
const PLAYER: MemberFacts = { userId: buyer(9), roleIds: [], isGuildOwner: false, isAdministrator: false };

const purchase = (id: number) => testDb().purchase.findUniqueOrThrow({ where: { id } });
const refundsOf = (id: number) => testDb().kpTransaction.findMany({ where: { reference: `refund:${id}` } });

describe('/отозвать without a refund (023 §1)', () => {
  it('ends the grant, takes the role back and moves no KP Coin', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    const role = await mediaRoleId(h);
    expect(h.gateway.holds(U, role)).toBe(true);

    const result = await h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: false });
    await h.shop.idle();

    expect(result).toMatchObject({ userId: U, refunded: null, cleaned: true });
    const row = await purchase(r.purchaseId);
    expect(row).toMatchObject({ status: 'REVOKED', revokedById: ADMIN.userId });
    expect(row.revokedAt).not.toBeNull();
    expect(row.cleanedAt).not.toBeNull();
    expect(h.gateway.holds(U, role)).toBe(false);
    expect(await balanceOf(U)).toBe(0);
    expect(await refundsOf(r.purchaseId)).toHaveLength(0);
    await expectShopInvariants();
  });

  it('writes the audit line before it tells the player, and the private message says no money came back', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    await h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: false });

    const names = h.logging.events.map((e) => e.name);
    expect(names.indexOf('shop.revoked')).toBeLessThan(names.indexOf('shop.revoke_notified'));
    const line = h.logging.events.find((e) => e.name === 'shop.revoked')?.audit ?? '';
    expect(line).toContain(`<@${ADMIN.userId}>`);
    expect(line).toContain(`<@${U}>`);
    expect(line).toContain('Доступ к картинкам и GIF');
    expect(line).toContain('без возврата');
    expect(h.gateway.dms).toContainEqual({ userId: U, notice: { kind: 'grant_revoked', goodName: 'Доступ к картинкам и GIF', amount: null } });
  });

  it('a closed private message is not an error', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    h.gateway.dmClosed.add(U);
    const r = await h.shop.buy(U, h.goods.media, 0);

    await expect(h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: false })).resolves.toMatchObject({ refunded: null });
    expect((await purchase(r.purchaseId)).status).toBe('REVOKED');
    expect(h.logging.events.find((e) => e.name === 'shop.revoke_notified')?.fields).toMatchObject({ sent: 'refused' });
  });
});

describe('/отозвать with a refund (023 §3)', () => {
  it('pays back the whole pricePaid once; a second attempt is refused and pays nothing', async () => {
    const h = await shopHarness();
    await fund(h, U, 15_000);
    const r = await h.shop.buy(U, h.goods.media, 0); // 5 000
    await h.shop.buy(U, h.goods.media, 1); // renewed: pricePaid is now 10 000
    expect(await balanceOf(U)).toBe(5000);

    const result = await h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 2, refund: true });
    await h.shop.idle();
    expect(result).toMatchObject({ refunded: 10_000, balanceAfter: 15_000 });
    expect(await balanceOf(U)).toBe(15_000);

    // The status guard is what makes the refund unrepeatable: the row is no longer ACTIVE.
    await expect(h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 2, refund: true })).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect(await refundsOf(r.purchaseId)).toHaveLength(1);
    expect(await balanceOf(U)).toBe(15_000);
    expect(h.gateway.dms.filter((d) => d.notice.kind === 'grant_revoked')).toHaveLength(1);
    await expectShopInvariants();
  });

  it('two administrators pressing at the same moment revoke once and refund once', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    const second = h.restart();

    const results = await Promise.allSettled([
      h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: true }),
      second.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: true }),
    ]);
    await h.shop.idle();

    expect(codes(results).filter((c) => c === null)).toHaveLength(1);
    expect(codes(results).filter((c) => c === 'STALE_PANEL')).toHaveLength(1);
    expect(await refundsOf(r.purchaseId)).toHaveLength(1);
    expect(await balanceOf(U)).toBe(5000);
    expect(h.logging.events.filter((e) => e.name === 'shop.revoked')).toHaveLength(1);
    await expectShopInvariants();
  });
});

describe('what the guards refuse (023 §1, §4)', () => {
  it('a panel drawn before a renewal is refused, and nothing changes', async () => {
    const h = await shopHarness();
    await fund(h, U, 15_000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    await h.shop.buy(U, h.goods.media, 1); // the panel's «1» is now out of date

    await expect(h.shop.revoke(ADMIN, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: true })).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect((await purchase(r.purchaseId)).status).toBe('ACTIVE');
    expect(await refundsOf(r.purchaseId)).toHaveLength(0);
    expect(h.gateway.holds(U, await mediaRoleId(h))).toBe(true);
    await expectShopInvariants();
  });

  it('a member without SHOP_MANAGE cannot list or revoke, and nothing is written', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    const before = h.logging.events.length;

    await expect(h.shop.revokeList(PLAYER, U)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(h.shop.revoke(PLAYER, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: true })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });

    expect((await purchase(r.purchaseId)).status).toBe('ACTIVE');
    expect(await refundsOf(r.purchaseId)).toHaveLength(0);
    expect(h.logging.events.length).toBe(before);
    expect(h.gateway.dms).toEqual([]);
    await expectShopInvariants();
  });

  it('a role granted SHOP_MANAGE may revoke (the right is data, not the command)', async () => {
    const h = await shopHarness();
    await testDb().roleCapability.create({ data: { roleId: '800000000000000001', capability: 'SHOP_MANAGE' } });
    const moderator: MemberFacts = { userId: buyer(8), roleIds: ['800000000000000001'], isGuildOwner: false, isAdministrator: false };
    await fund(h, U, 5000);
    const r = await h.shop.buy(U, h.goods.media, 0);

    await expect(h.shop.revoke(moderator, { purchaseId: r.purchaseId, expectedPeriods: 1, refund: false })).resolves.toMatchObject({ refunded: null });
    expect((await purchase(r.purchaseId)).revokedById).toBe(moderator.userId);
    await expectShopInvariants();
  });
});

describe('what «the grant ends» means for each kind (023 §2)', () => {
  it('a clan is closed: its role is deleted, its members and its name are free again', async () => {
    const h = await shopHarness();
    const member = buyer(2);
    await fund(h, U, 40_000);
    const bought = await h.shop.buy(U, h.goods.clan, 0, { clan: { name: 'Волки', colorIndex: 0 } });
    await h.clans.addMembers(U, [member]);
    await h.shop.idle();
    const clanBefore = await testDb().clan.findFirstOrThrow({ where: { purchaseId: bought.purchaseId } });
    expect(clanBefore.roleId).not.toBeNull();

    await h.shop.revoke(ADMIN, { purchaseId: bought.purchaseId, expectedPeriods: 1, refund: false });
    await h.shop.idle();

    const clan = await testDb().clan.findUniqueOrThrow({ where: { id: clanBefore.id } });
    expect(clan.closedAt).not.toBeNull();
    expect(clan.memberCount).toBe(0);
    expect(await testDb().clanMember.count({ where: { clanId: clan.id } })).toBe(0);
    expect(await h.clans.forUser(member)).toBeNull();
    expect(h.gateway.roleDeletes).toContain(clanBefore.roleId);
    // The name is free: the same player may buy the clan again and call it «Волки».
    await expect(h.shop.buy(U, h.goods.clan, 0, { clan: { name: 'Волки', colorIndex: 0 } })).resolves.toMatchObject({ kind: 'clan_role' });
    await expectShopInvariants();
  });

  it('a personal room is deleted by the convergence pass', async () => {
    const h = await shopHarness();
    await fund(h, U, 10_000);
    const bought = await h.shop.buy(U, h.goods.room, 0);
    await h.shop.idle();
    const room = await testDb().personalRoom.findFirstOrThrow({ where: { purchaseId: bought.purchaseId } });
    expect(room.channelId).not.toBeNull();

    await h.shop.revoke(ADMIN, { purchaseId: bought.purchaseId, expectedPeriods: 1, refund: true });
    await h.shop.idle();

    expect(h.gateway.deleted).toContain(room.channelId);
    expect(h.gateway.rooms.has(room.channelId ?? '')).toBe(false);
    expect((await purchase(bought.purchaseId)).cleanedAt).not.toBeNull();
    expect(await balanceOf(U)).toBe(10_000);
    await expectShopInvariants();
  });
});

describe('the list the administrator picks from (023 §1)', () => {
  it('shows only ACTIVE purchases, with what was paid and the end date', async () => {
    const h = await shopHarness();
    await fund(h, U, 20_000);
    const media = await h.shop.buy(U, h.goods.media, 0);
    const room = await h.shop.buy(U, h.goods.room, 0);
    await h.shop.revoke(ADMIN, { purchaseId: room.purchaseId, expectedPeriods: 1, refund: false });

    const items = await h.shop.revokeList(ADMIN, U);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ purchaseId: media.purchaseId, goodName: 'Доступ к картинкам и GIF', periods: 1, pricePaid: 5000, applied: true });
    expect(items[0]?.expiresAt).toEqual(media.expiresAt);
    expect(await h.shop.revokeList(ADMIN, buyer(7))).toEqual([]);
  });
});
