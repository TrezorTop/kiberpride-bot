// `/выдать-товар` (decision 024 §1): an administrator hands a good out, and the ledger never
// hears about it. The guards that matter: no KP Coin row is written and no balance moves, a
// second hand-out extends instead of creating a second grant, two invocations at once grant once,
// a player without SHOP_MANAGE writes nothing, and a handed-out clan behaves like a bought one.
import { describe, expect, it } from 'vitest';
import { fakeUserId } from '../../../src/core/match.js';
import { GRANT_GOOD_CHOICES } from '../../../src/discord/commands/grantGood.js';
import { GRANT_DAYS_MAX } from '../../../src/modules/shop/service.js';
import { testDb } from '../helpers.js';
import { ADMIN, balanceOf, buyer, codes, DAY, expectShopInvariants, fund, mediaRoleId, player, shopHarness } from './harness.js';

const U = buyer(1);
const PLAYER = player(buyer(9));

const purchase = (id: number) => testDb().purchase.findUniqueOrThrow({ where: { id } });
const ledgerOf = (userId: string) => testDb().kpTransaction.findMany({ where: { userId } });

describe('a hand-out creates a grant nobody paid for (024 §1)', () => {
  it('writes an ACTIVE purchase with pricePaid 0, no ledger row, and gives the role', async () => {
    const h = await shopHarness();
    const result = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 });
    await h.shop.idle();

    expect(result).toMatchObject({ userId: U, goodName: 'Доступ к картинкам и GIF', days: 30, periods: 1, extended: false, applied: true, notified: true });
    const row = await purchase(result.purchaseId);
    expect(row).toMatchObject({ status: 'ACTIVE', pricePaid: 0, periods: 1, userId: U });
    expect(row.expiresAt).toEqual(new Date(h.clock.now().getTime() + 30 * DAY));

    // The one rule this command must not break: money did not move, so the ledger is silent.
    expect(await ledgerOf(U)).toEqual([]);
    expect(await balanceOf(U)).toBe(0);
    expect(h.gateway.holds(U, await mediaRoleId(h))).toBe(true);
    await expectShopInvariants();
  });

  // The player below could pay twice over: if the hand-out ever charged, the balance and the
  // ledger would show it here, not just an INSUFFICIENT_FUNDS refusal for a poorer player.
  it('a rich player is not charged either: the balance and the ledger are exactly what they were', async () => {
    const h = await shopHarness();
    await fund(h, U, 50_000);
    const before = await ledgerOf(U);

    const result = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 });
    await h.shop.idle();

    expect(await balanceOf(U)).toBe(50_000);
    expect(await ledgerOf(U)).toEqual(before);
    expect(await testDb().kpTransaction.count({ where: { purchaseId: result.purchaseId } })).toBe(0);
    expect((await purchase(result.purchaseId)).pricePaid).toBe(0);
    await expectShopInvariants();
  });

  it('logs one line naming the administrator, the player, the good and the days, then tells the player', async () => {
    const h = await shopHarness();
    await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 7 });

    const names = h.logging.events.map((e) => e.name);
    expect(names.indexOf('shop.granted')).toBeLessThan(names.indexOf('shop.grant_notified'));
    const line = h.logging.events.find((e) => e.name === 'shop.granted')?.audit ?? '';
    expect(line).toContain(`<@${ADMIN.userId}>`);
    expect(line).toContain(`<@${U}>`);
    expect(line).toContain('Доступ к картинкам и GIF');
    expect(line).toContain('7 дн.');
    expect(line).toContain('KP Coin не списаны');
    expect(h.gateway.dms.map((d) => d.notice.kind)).toContain('grant_gifted');
  });

  it('a closed private message is not an error', async () => {
    const h = await shopHarness();
    h.gateway.dmClosed.add(U);
    await expect(h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 })).resolves.toMatchObject({ notified: false });
    expect((await testDb().purchase.findFirstOrThrow({ where: { userId: U } })).status).toBe('ACTIVE');
  });
});

describe('handing out what the player already has extends it (024 §1)', () => {
  it('adds the days to what is left and bumps the period count, still without a ledger row', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    const bought = await h.shop.buy(U, h.goods.media, 0);
    const paidRows = (await ledgerOf(U)).length;

    const result = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 10 });
    expect(result).toMatchObject({ purchaseId: bought.purchaseId, extended: true, periods: 2, days: 10 });
    const row = await purchase(bought.purchaseId);
    expect(row.expiresAt).toEqual(new Date((bought.expiresAt ?? new Date()).getTime() + 10 * DAY));
    // The player paid for their own first period and nothing more: pricePaid stays what they paid.
    expect(row.pricePaid).toBe(5000);
    expect(await ledgerOf(U)).toHaveLength(paidRows);
    expect(await balanceOf(U)).toBe(0);
    await expectShopInvariants();
  });

  it('extends a grant that was itself handed out, and never makes a second ACTIVE row', async () => {
    const h = await shopHarness();
    const first = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 5 });
    const second = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 5 });

    expect(second.purchaseId).toBe(first.purchaseId);
    expect(second.expiresAt).toEqual(new Date(h.clock.now().getTime() + 10 * DAY));
    expect(await testDb().purchase.count({ where: { userId: U, status: 'ACTIVE' } })).toBe(1);
    expect(await ledgerOf(U)).toEqual([]);
    await expectShopInvariants();
  });

  it('two administrators pressing at the same moment hand it out once', async () => {
    const h = await shopHarness();
    const second = h.restart();
    const results = await Promise.allSettled([
      h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 }),
      second.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 }),
    ]);
    await h.shop.idle();

    expect(codes(results).filter((c) => c === null)).toHaveLength(1);
    expect(codes(results).filter((c) => c === 'GRANT_RACED')).toHaveLength(1);
    const rows = await testDb().purchase.findMany({ where: { userId: U } });
    expect(rows).toHaveLength(1);
    // Granted once means 30 days, not 60: the loser neither inserted nor extended.
    expect(rows[0]?.expiresAt).toEqual(new Date(h.clock.now().getTime() + 30 * DAY));
    expect(rows[0]?.periods).toBe(1);
    expect(h.logging.events.filter((e) => e.name === 'shop.granted')).toHaveLength(1);
    await expectShopInvariants();
  });

  // The two paths that extend the same row are different code — a guarded UPDATE that also moves
  // KP Coin, and one that moves nothing — so they are raced against each other, not only against
  // themselves (architect review 2026-09-20, F2).
  it('a hand-out racing the player’s own paid renewal: one wins, and the player pays at most once', async () => {
    const h = await shopHarness();
    await fund(h, U, 20_000);
    const bought = await h.shop.buy(U, h.goods.media, 0);
    const second = h.restart();

    const results = await Promise.allSettled([
      h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 10 }),
      second.buy(U, h.goods.media, 1),
    ]);
    await h.shop.idle();

    expect(codes(results).filter((c) => c === null)).toHaveLength(1);
    // The loser is refused by the period guard, whichever of the two it happens to be.
    expect(['GRANT_RACED', 'STALE_PANEL']).toContain(codes(results).find((c) => c !== null));

    const row = await purchase(bought.purchaseId);
    expect(row.periods).toBe(2); // exactly one of them added a period
    const charged = await testDb().kpTransaction.findMany({ where: { purchaseId: bought.purchaseId, kind: 'PURCHASE' } });
    // One charge for the first purchase, and a second only if the paid renewal is the one that won.
    expect(charged.length).toBe(results[1]?.status === 'fulfilled' ? 2 : 1);
    expect(row.pricePaid).toBe(5000 * charged.length);
    expect(await balanceOf(U)).toBe(20_000 - 5000 * charged.length);
    await expectShopInvariants();
  });

  it('two hand-outs at once on an existing grant add the days once', async () => {
    const h = await shopHarness();
    const first = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 });
    const second = h.restart();
    const results = await Promise.allSettled([
      h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 10 }),
      second.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 10 }),
    ]);

    expect(codes(results).filter((c) => c === null)).toHaveLength(1);
    const row = await purchase(first.purchaseId);
    expect(row.periods).toBe(2);
    expect(row.expiresAt).toEqual(new Date(h.clock.now().getTime() + 40 * DAY));
    await expectShopInvariants();
  });
});

describe('what a hand-out refuses (024 §1, §2)', () => {
  it('a member without SHOP_MANAGE hands out nothing, and nothing is written', async () => {
    const h = await shopHarness();
    const before = h.logging.events.length;

    await expect(h.shop.grantByAdmin(PLAYER, { userId: U, goodId: h.goods.media, days: 30 })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });

    expect(await testDb().purchase.count()).toBe(0);
    expect(await ledgerOf(U)).toEqual([]);
    expect(h.logging.events.length).toBe(before);
    expect(h.gateway.dms).toEqual([]);
    await expectShopInvariants();
  });

  it('a role granted SHOP_MANAGE may hand out (the right is data, not the command)', async () => {
    const h = await shopHarness();
    await testDb().roleCapability.create({ data: { roleId: '800000000000000003', capability: 'SHOP_MANAGE' } });
    const moderator = { userId: buyer(8), roleIds: ['800000000000000003'], isGuildOwner: false, isAdministrator: false };

    await expect(h.shop.grantByAdmin(moderator, { userId: U, goodId: h.goods.media, days: 30 })).resolves.toMatchObject({ extended: false });
    expect(h.logging.events.find((e) => e.name === 'shop.granted')?.fields).toMatchObject({ actorId: moderator.userId });
  });

  it('a bot, a fake player, a bad number of days and a switched-off good are all refused', async () => {
    const h = await shopHarness();
    await expect(h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30, targetIsBot: true })).rejects.toMatchObject({ code: 'TARGET_IS_BOT' });
    await expect(h.shop.grantByAdmin(ADMIN, { userId: fakeUserId(1), goodId: h.goods.media, days: 30 })).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 0 })).rejects.toMatchObject({ code: 'DAYS_INVALID' });
    await expect(h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: GRANT_DAYS_MAX + 1 })).rejects.toMatchObject({ code: 'DAYS_INVALID' });

    // A good the owner switched off is not handed out either; the refusal names it (024 §1).
    await h.shop.setEnabled(ADMIN, h.goods.media, false);
    await expect(h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.media, days: 30 })).rejects.toMatchObject({
      code: 'GOOD_DISABLED',
      params: { goodName: 'Доступ к картинкам и GIF' },
    });

    expect(await testDb().purchase.count()).toBe(0);
    await expectShopInvariants();
  });
});

describe('the command’s own list of goods (024 §1)', () => {
  // The choices are static in the command while the goods live in the database: a slug that is
  // not in the catalogue would fail as «не нашёл это» only when an administrator picked it
  // (architect review 2026-09-20, F3).
  it('every good `/выдать-товар` offers is really in the catalogue, and none is missing', async () => {
    const h = await shopHarness();
    for (const choice of GRANT_GOOD_CHOICES) {
      const good = await h.shop.goodBySlug(choice.value);
      expect({ slug: choice.value, found: good?.slug ?? null }).toEqual({ slug: choice.value, found: choice.value });
    }
    const catalogue = (await testDb().shopGood.findMany({ select: { slug: true } })).map((g) => g.slug).sort();
    expect(catalogue).toEqual([...GRANT_GOOD_CHOICES.map((c) => c.value)].sort());
  });
});

describe('a handed-out clan and room behave like bought ones (024 §1, Consequences)', () => {
  it('creates the clan with the name given, and `/отозвать` frees it again', async () => {
    const h = await shopHarness();
    const result = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.clan, days: 30, clan: { name: 'Подарок', colorIndex: 0 } });
    await h.shop.idle();

    const clan = await testDb().clan.findFirstOrThrow({ where: { purchaseId: result.purchaseId } });
    expect(clan).toMatchObject({ name: 'Подарок', ownerId: U, closedAt: null });
    expect(clan.roleId).not.toBeNull();
    expect(await h.clans.forUser(U)).toMatchObject({ name: 'Подарок', isOwner: true });
    expect(await ledgerOf(U)).toEqual([]);

    await h.shop.revoke(ADMIN, { purchaseId: result.purchaseId, expectedPeriods: 1, refund: false });
    await h.shop.idle();
    expect((await testDb().clan.findUniqueOrThrow({ where: { id: clan.id } })).closedAt).not.toBeNull();
    expect(h.gateway.roleDeletes).toContain(clan.roleId);
    expect(await h.clans.forUser(U)).toBeNull();
    await expectShopInvariants();
  });

  it('a refund of a handed-out purchase gives nothing back, and the ledger stays silent (023 F5)', async () => {
    const h = await shopHarness();
    const result = await h.shop.grantByAdmin(ADMIN, { userId: U, goodId: h.goods.room, days: 30, roomName: '🏠 Подарок' });
    await h.shop.idle();
    expect(await h.rooms.forOwner(U)).toMatchObject({ name: '🏠 Подарок', ownerId: U });

    const revoked = await h.shop.revoke(ADMIN, { purchaseId: result.purchaseId, expectedPeriods: 1, refund: true });
    await h.shop.idle();
    expect(revoked.refunded).toBe(0);
    expect(await balanceOf(U)).toBe(0);
    expect(await ledgerOf(U)).toEqual([]);
    expect(await h.rooms.forOwner(U)).toBeNull();
    await expectShopInvariants();
  });
});
