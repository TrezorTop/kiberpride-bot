// Grants over time (decision 014 §2, §4): convergence per (user, good), expiry, the one warning,
// retries, the refund of a grant that never worked, a returning buyer, a restart.
import { describe, expect, it } from 'vitest';
import { runGrantsPass } from '../../../src/jobs/grants.js';
import { testDb } from '../helpers.js';
import { balanceOf, buyer, DAY, expectShopInvariants, fund, mediaRoleId, shopHarness } from './harness.js';

const U = buyer(1);
const MIN = 60_000;

describe('expiry (014 §4.2)', () => {
  it('expires the row, takes the role back, marks it cleaned and logs the line', async () => {
    const h = await shopHarness();
    await fund(h, U, 5000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    const role = await mediaRoleId(h);
    expect(h.gateway.holds(U, role)).toBe(true);

    h.clock.advance(30 * DAY - MIN);
    expect(await h.shop.expirePass(h.clock.now())).toEqual([]);
    h.clock.advance(MIN);
    expect(await h.shop.expirePass(h.clock.now())).toEqual([r.purchaseId]);
    await h.shop.idle();

    const row = await testDb().purchase.findUniqueOrThrow({ where: { id: r.purchaseId } });
    expect(row.status).toBe('EXPIRED');
    expect(row.cleanedAt).not.toBeNull();
    expect(h.gateway.holds(U, role)).toBe(false);
    expect(h.logging.events.find((e) => e.name === 'shop.expired')?.audit).toMatch(/закончилось/);
    await expectShopInvariants();
  });
});

describe('a shared role converges per (user, good) (014 §2)', () => {
  it('an expired row cleaned after the new ACTIVE row exists keeps the role', async () => {
    const h = await shopHarness();
    await fund(h, U, 10_000);
    const old = await h.shop.buy(U, h.goods.media, 0);
    const role = await mediaRoleId(h);
    // The expiry committed but its pass was lost (a crash): the row is EXPIRED and not cleaned.
    await testDb().purchase.update({ where: { id: old.purchaseId }, data: { status: 'EXPIRED' } });
    const fresh = await h.shop.buy(U, h.goods.media, 0); // a new ACTIVE row; its pass sees both
    await h.shop.idle();

    expect(fresh.purchaseId).not.toBe(old.purchaseId);
    expect((await testDb().purchase.findUniqueOrThrow({ where: { id: old.purchaseId } })).cleanedAt).not.toBeNull();
    expect(h.gateway.holds(U, role)).toBe(true);
    expect(h.gateway.roleOps.filter((op) => op.startsWith('-'))).toEqual([]); // never taken away, not even for a moment
    await expectShopInvariants();
  });

  it('an expired row cleaned before the new purchase: the role goes, then comes back with the new row', async () => {
    const h = await shopHarness();
    await fund(h, U, 10_000);
    await h.shop.buy(U, h.goods.media, 0);
    const role = await mediaRoleId(h);
    h.clock.advance(30 * DAY);
    await h.shop.expirePass(h.clock.now());
    await h.shop.idle();
    expect(h.gateway.holds(U, role)).toBe(false);

    const fresh = await h.shop.buy(U, h.goods.media, 0);
    expect(fresh.applied).toBe(true);
    // A late replay of the old row's pass must not take the paid role away again.
    await h.shop.reconcile(U, h.goods.media);
    await h.shop.reconcileAll();
    expect(h.gateway.holds(U, role)).toBe(true);
    await expectShopInvariants();
  });
});

describe('the warning a day before the end (014 §4.1, 015 §1)', () => {
  it('is claimed and sent once; a renewal re-arms it; a closed DM is not retried', async () => {
    const h = await shopHarness();
    const other = buyer(2);
    await fund(h, U, 20_000);
    await fund(h, other, 20_000);
    h.gateway.dmClosed.add(other);
    const mine = await h.shop.buy(U, h.goods.media, 0);
    await h.shop.buy(other, h.goods.media, 0);

    h.clock.advance(28 * DAY);
    expect(await h.shop.warnPass(h.clock.now())).toEqual([]);
    h.clock.advance(DAY + MIN);
    const warned = await Promise.all([h.shop.warnPass(h.clock.now()), h.shop.warnPass(h.clock.now())]);
    expect(warned.flat().sort()).toHaveLength(2); // each purchase claimed by exactly one pass
    expect(h.gateway.dms).toEqual([{ userId: U, notice: { kind: 'grant_expiring', goodName: 'Доступ к картинкам и GIF', expiresAt: mine.expiresAt } }]);
    expect(await h.shop.warnPass(h.clock.now())).toEqual([]);

    await h.shop.buy(U, h.goods.media, 1); // renewed: the next end gets its own warning
    expect((await testDb().purchase.findUniqueOrThrow({ where: { id: mine.purchaseId } })).warnedAt).toBeNull();
    await expectShopInvariants();
  });
});

describe('retry and refund (014 §2)', () => {
  it('keeps the money while retrying, logs the first failure once, refunds after 30 minutes — once', async () => {
    const h = await shopHarness({ applyWaitMs: 50 });
    await fund(h, U, 6000);
    h.gateway.failRoleOps = true;
    const r = await h.shop.buy(U, h.goods.media, 0);
    await h.shop.idle();
    expect(r.applied).toBe(false);
    expect(await balanceOf(U)).toBe(1000);

    h.clock.advance(10 * MIN);
    await runGrantsPass({ shop: h.shop, logging: h.logging, clock: h.clock });
    await h.shop.idle();
    const row = await testDb().purchase.findUniqueOrThrow({ where: { id: r.purchaseId } });
    expect(row).toMatchObject({ status: 'ACTIVE', appliedAt: null });
    expect(row.lastApplyError).toMatch(/50013/);
    expect(h.logging.events.filter((e) => e.name === 'shop.apply_failed' && e.audit)).toHaveLength(1);

    h.clock.advance(21 * MIN);
    await Promise.all([h.shop.retryPass(h.clock.now()), h.restart().retryPass(h.clock.now()), h.shop.reconcile(U, h.goods.media)]);
    await h.shop.idle();
    const refunded = await testDb().purchase.findUniqueOrThrow({ where: { id: r.purchaseId } });
    expect(refunded.status).toBe('REFUNDED');
    expect(await balanceOf(U)).toBe(6000);
    const refunds = await testDb().kpTransaction.findMany({ where: { reference: `refund:${r.purchaseId}` } });
    expect(refunds).toHaveLength(1);
    expect(h.gateway.dms.filter((d) => d.notice.kind === 'grant_refunded')).toHaveLength(1);
    await expectShopInvariants();
  });

  it('never refunds a buyer who is away; they get the grant when they return', async () => {
    const h = await shopHarness({ applyWaitMs: 50 });
    await fund(h, U, 6000);
    h.gateway.absent.add(U);
    const r = await h.shop.buy(U, h.goods.media, 0);
    expect(r.applied).toBe(false);

    h.clock.advance(2 * 3_600_000);
    await runGrantsPass({ shop: h.shop, logging: h.logging, clock: h.clock });
    await h.shop.idle();
    expect((await testDb().purchase.findUniqueOrThrow({ where: { id: r.purchaseId } })).status).toBe('ACTIVE');

    h.gateway.absent.delete(U);
    await h.shop.memberJoined(U);
    await h.shop.idle();
    const row = await testDb().purchase.findUniqueOrThrow({ where: { id: r.purchaseId } });
    expect(row.appliedAt).not.toBeNull();
    expect(h.gateway.holds(U, await mediaRoleId(h))).toBe(true);
    await expectShopInvariants();
  });
});

describe('restart recovery (014 §4.3)', () => {
  it('a new process applies a grant whose pass was lost and cleans an ended row', async () => {
    const h = await shopHarness();
    await fund(h, U, 20_000);
    const a = await h.shop.buy(U, h.goods.media, 0);
    const role = await mediaRoleId(h);
    // Lost state: the grant «was never applied», and someone removed the role by hand.
    await testDb().purchase.update({ where: { id: a.purchaseId }, data: { appliedAt: null } });
    await h.gateway.setMemberRole(U, role ?? '', false);

    const fresh = h.restart();
    await fresh.startup();
    await fresh.idle();
    expect((await testDb().purchase.findUniqueOrThrow({ where: { id: a.purchaseId } })).appliedAt).not.toBeNull();
    expect(h.gateway.holds(U, role)).toBe(true);
    expect(h.logging.events.find((e) => e.name === 'shop.startup')?.fields).toMatchObject({ enabledGoods: 3 });
    await expectShopInvariants();
  });

  it('disables an enabled good whose config is broken, and logs it', async () => {
    const h = await shopHarness();
    await testDb().shopGood.update({ where: { id: h.goods.room }, data: { config: { categoryId: 42 } } });
    await h.shop.startup();
    expect((await testDb().shopGood.findUniqueOrThrow({ where: { id: h.goods.room } })).enabled).toBe(false);
    expect(h.logging.events.find((e) => e.name === 'shop.good_disabled_at_start')?.audit).toMatch(/выключен/);
  });
});

describe('dev tools (014 §12)', () => {
  it('«Закончить через 2 минуты» works only for the guild owner outside production', async () => {
    const h = await shopHarness();
    await fund(h, U, 6000);
    const r = await h.shop.buy(U, h.goods.media, 0);
    const owner = { userId: U, roleIds: [], isGuildOwner: true, isAdministrator: false };
    await expect(h.shop.devExpireSoon({ ...owner, isGuildOwner: false }, r.purchaseId)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    const at = await h.shop.devExpireSoon(owner, r.purchaseId);
    expect(at.getTime()).toBe(h.clock.now().getTime() + 2 * MIN);

    await expect(h.restart('production').devExpireSoon(owner, r.purchaseId)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });
});
