// Buying and renewing (decision 014 §1–§2) against a real Postgres. Every money guarantee is a
// database guard, so every one is exercised with concurrent calls on separate pool connections,
// and every test ends with sum(ledger) = balance.
import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers.js';
import { ACCESS_CHANNEL_A, balanceOf, buyer, codes, DAY, expectShopInvariants, fund, mediaRoleId, shopHarness } from './harness.js';

const U = buyer(1);

describe('buy — a new purchase (014 §1)', () => {
  it('debits the price once, applies the role, and writes purchase:<id>:1', async () => {
    const h = await shopHarness();
    await fund(h, U, 8000);
    const r = await h.shop.buy(U, h.goods.media, 0);

    expect(r).toMatchObject({ periods: 1, renewed: false, applied: true, balanceAfter: 3000 });
    expect(r.expiresAt?.getTime()).toBe(h.clock.now().getTime() + 30 * DAY);
    expect(h.gateway.holds(U, await mediaRoleId(h))).toBe(true);
    const ledger = await testDb().kpTransaction.findMany({ where: { purchaseId: r.purchaseId } });
    expect(ledger.map((l) => [l.reference, l.amount, l.kind])).toEqual([[`purchase:${r.purchaseId}:1`, -5000, 'PURCHASE']]);
    expect(h.logging.events.some((e) => e.name === 'shop.purchased' && e.audit?.includes('купил'))).toBe(true);
    await expectShopInvariants();
  });

  it('ten concurrent buys of one good: one purchase, one debit, the rest ALREADY_OWNED', async () => {
    const h = await shopHarness();
    await fund(h, U, 50_000);
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => h.shop.buy(U, h.goods.media, 0)));

    expect(codes(settled).filter((c) => c === null)).toHaveLength(1);
    expect(codes(settled).filter((c) => c !== null).every((c) => c === 'ALREADY_OWNED')).toBe(true);
    expect(await testDb().purchase.count()).toBe(1);
    expect(await balanceOf(U)).toBe(45_000);
    await expectShopInvariants();
  });

  it('refuses a buyer who is short and leaves nothing behind', async () => {
    const h = await shopHarness();
    await fund(h, U, 4999);
    await expect(h.shop.buy(U, h.goods.media, 0)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await testDb().purchase.count()).toBe(0);
    expect(await balanceOf(U)).toBe(4999);
    await expectShopInvariants();
  });

  it('refuses a disabled good before any money moves', async () => {
    const h = await shopHarness();
    await fund(h, U, 10_000);
    await testDb().shopGood.update({ where: { id: h.goods.media }, data: { enabled: false } });
    await expect(h.shop.buy(U, h.goods.media, 0)).rejects.toMatchObject({ code: 'GOOD_DISABLED' });
    expect(await balanceOf(U)).toBe(10_000);
  });

  it('a precheck problem is SHOP_UNAVAILABLE with a log line, and no KP moves', async () => {
    const h = await shopHarness();
    await fund(h, U, 10_000);
    h.gateway.accessChannels.delete(ACCESS_CHANNEL_A); // the channel was deleted on the server
    await expect(h.shop.buy(U, h.goods.media, 0)).rejects.toMatchObject({ code: 'SHOP_UNAVAILABLE' });
    expect(await balanceOf(U)).toBe(10_000);
    expect(await testDb().purchase.count()).toBe(0);
    const line = h.logging.events.find((e) => e.name === 'shop.precheck_failed');
    expect(line?.audit).toMatch(/не найден/);
    await expectShopInvariants();
  });

  it('charges the price current at confirm, never one carried by the button', async () => {
    const h = await shopHarness();
    await fund(h, U, 10_000);
    const quote = await h.shop.quote(U, h.goods.media);
    expect(quote.price).toBe(5000);
    await testDb().shopGood.update({ where: { id: h.goods.media }, data: { price: 6000 } });
    const r = await h.shop.buy(U, h.goods.media, quote.expectedPeriods);
    expect(r.balanceAfter).toBe(4000);
    await expectShopInvariants();
  });
});

describe('renewal (014 §1)', () => {
  it('extends the same row by 30 days from the current end, resets the warning, writes period 2', async () => {
    const h = await shopHarness();
    await fund(h, U, 20_000);
    const first = await h.shop.buy(U, h.goods.media, 0);
    await testDb().purchase.update({ where: { id: first.purchaseId }, data: { warnedAt: h.clock.now() } });
    h.clock.advance(10 * DAY);

    const quote = await h.shop.quote(U, h.goods.media);
    expect(quote).toMatchObject({ mode: 'renew', expectedPeriods: 1 });
    const r = await h.shop.buy(U, h.goods.media, quote.expectedPeriods);

    expect(r).toMatchObject({ purchaseId: first.purchaseId, periods: 2, renewed: true });
    expect(r.expiresAt?.getTime()).toBe((first.expiresAt?.getTime() ?? 0) + 30 * DAY);
    const row = await testDb().purchase.findUniqueOrThrow({ where: { id: first.purchaseId } });
    expect(row).toMatchObject({ periods: 2, pricePaid: 10_000, warnedAt: null, status: 'ACTIVE' });
    const refs = (await testDb().kpTransaction.findMany({ where: { purchaseId: first.purchaseId }, orderBy: { id: 'asc' } })).map((t) => t.reference);
    expect(refs).toEqual([`purchase:${first.purchaseId}:1`, `purchase:${first.purchaseId}:2`]);
    await expectShopInvariants();
  });

  it('a double click renews once: ten concurrent renewals with one expected period', async () => {
    const h = await shopHarness();
    await fund(h, U, 100_000);
    const first = await h.shop.buy(U, h.goods.media, 0);
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => h.shop.buy(U, h.goods.media, 1)));

    expect(codes(settled).filter((c) => c === null)).toHaveLength(1);
    expect(codes(settled).filter((c) => c !== null).every((c) => c === 'STALE_PANEL')).toBe(true);
    const row = await testDb().purchase.findUniqueOrThrow({ where: { id: first.purchaseId } });
    expect(row.periods).toBe(2);
    expect(await balanceOf(U)).toBe(100_000 - 10_000);
    await expectShopInvariants();
  });

  it('an unapplied purchase cannot be renewed', async () => {
    const h = await shopHarness({ applyWaitMs: 50 });
    await fund(h, U, 20_000);
    h.gateway.failRoleOps = true;
    const first = await h.shop.buy(U, h.goods.media, 0);
    await h.shop.idle();
    expect(first.applied).toBe(false);
    expect((await h.shop.quote(U, h.goods.media)).mode).toBe('pending');
    await expect(h.shop.buy(U, h.goods.media, 1)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect(await balanceOf(U)).toBe(15_000);
    await expectShopInvariants();
  });

  it('a renewal racing the expiry job either extends or finds EXPIRED — never both', async () => {
    for (let round = 0; round < 6; round++) {
      const h = await shopHarness();
      const u = `${U.slice(0, -1)}${round}`;
      await fund(h, u, 20_000);
      const first = await h.shop.buy(u, h.goods.media, 0);
      h.clock.advance(30 * DAY); // exactly at the end: the job may expire it now

      const [renew, expired] = await Promise.allSettled([h.shop.buy(u, h.goods.media, 1), h.shop.expirePass(h.clock.now())]);
      await h.shop.idle();
      const row = await testDb().purchase.findUniqueOrThrow({ where: { id: first.purchaseId } });
      const expiredIds = expired.status === 'fulfilled' ? expired.value : [];
      if (renew.status === 'fulfilled') {
        expect(row).toMatchObject({ status: 'ACTIVE', periods: 2 });
        expect(expiredIds).not.toContain(first.purchaseId);
        expect(row.expiresAt?.getTime()).toBeGreaterThan(h.clock.now().getTime());
      } else {
        expect((renew.reason as { code?: string }).code).toBe('STALE_PANEL');
        expect(row).toMatchObject({ status: 'EXPIRED', periods: 1 });
        expect(await balanceOf(u)).toBe(15_000);
      }
      await expectShopInvariants();
      await testDb().$executeRawUnsafe('TRUNCATE "KpTransaction", "Purchase", "ShopGood", "User", "Clan", "ClanMember", "PersonalRoom", "RoomGuest" RESTART IDENTITY CASCADE');
    }
  });

  it('a good that lasts forever has nothing to renew', async () => {
    const h = await shopHarness();
    await fund(h, U, 20_000);
    await testDb().shopGood.update({ where: { id: h.goods.media }, data: { validityDays: null } });
    const r = await h.shop.buy(U, h.goods.media, 0);
    expect(r.expiresAt).toBeNull();
    expect((await h.shop.quote(U, h.goods.media)).mode).toBe('owned');
    await expect(h.shop.buy(U, h.goods.media, 1)).rejects.toMatchObject({ code: 'ALREADY_OWNED' });
    await expectShopInvariants();
  });
});
