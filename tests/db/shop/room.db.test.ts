// Personal rooms (decision 014 §3.3, 015 §5): created locked in the chosen category, controlled
// only through the bot, guests under concurrency, a removed guest disconnected, expiry.
import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers.js';
import { buyer, DAY, expectShopInvariants, fund, ROOM_CATEGORY, shopHarness } from './harness.js';

const OWNER = buyer(1);

describe('personal room', () => {
  it('is created locked in the category with the owner let in, and survives a renewal', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 20_000);
    const r = await h.shop.buy(OWNER, h.goods.room, 0, { roomName: '🏠 Комната Васи' });
    expect(r.applied).toBe(true);
    const view = await h.rooms.forOwner(OWNER);
    const channel = h.gateway.rooms.get(view?.channelId ?? '');
    expect(channel).toMatchObject({ name: '🏠 Комната Васи', categoryId: ROOM_CATEGORY, locked: true, userLimit: 0, allowUserIds: [OWNER] });

    await h.shop.buy(OWNER, h.goods.room, 1);
    await h.shop.idle();
    expect(h.gateway.roomCreates).toHaveLength(1);
    await expectShopInvariants();
  });

  it('the owner renames, limits and opens it through the bot; bad input is refused', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0, { roomName: 'Комната' });
    await h.rooms.update(OWNER, { name: 'Штаб 🎧', userLimit: 5, locked: false });
    const view = await h.rooms.forOwner(OWNER);
    expect(h.gateway.rooms.get(view?.channelId ?? '')).toMatchObject({ name: 'Штаб 🎧', userLimit: 5, locked: false });
    await expect(h.rooms.update(OWNER, { userLimit: 11 })).rejects.toMatchObject({ code: 'STALE_PANEL' });
    await expect(h.rooms.update(OWNER, { name: '#канал' })).rejects.toMatchObject({ code: 'NAME_INVALID' });
    await expect(h.rooms.update(buyer(2), { locked: true })).rejects.toMatchObject({ code: 'NO_ROOM' });
  });

  it('thirty concurrent invitations fill 25 seats exactly; the counter equals the rows', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);
    const guests = Array.from({ length: 30 }, (_, i) => buyer(100 + i));
    const results = await Promise.all(guests.map((g) => h.rooms.addGuests(OWNER, [g])));
    await h.shop.idle();
    expect(results.flatMap((r) => r.added)).toHaveLength(25);
    expect(results.flatMap((r) => r.refused.map((x) => x.code)).every((c) => c === 'ROOM_FULL')).toBe(true);
    const view = await h.rooms.forOwner(OWNER);
    expect(h.gateway.rooms.get(view?.channelId ?? '')?.allowUserIds).toHaveLength(26);
    await expectShopInvariants();
  });

  it('a removed guest loses the overwrite first and is then disconnected', async () => {
    const h = await shopHarness();
    const guest = buyer(2);
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);
    await h.rooms.addGuests(OWNER, [guest, OWNER]);
    const view = await h.rooms.forOwner(OWNER);
    const channelId = view?.channelId ?? '';
    expect(h.gateway.rooms.get(channelId)?.allowUserIds).toEqual([OWNER, guest]);

    await h.rooms.removeGuest(OWNER, guest);
    expect(h.gateway.rooms.get(channelId)?.allowUserIds).toEqual([OWNER]);
    expect(h.gateway.disconnects).toEqual([{ userId: guest, channelId }]);
    await expect(h.rooms.removeGuest(OWNER, guest)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expectShopInvariants();
  });

  it('an owner who is away keeps the room, without their overwrite until they return (Q17)', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);
    const channelId = (await h.rooms.forOwner(OWNER))?.channelId ?? '';
    h.gateway.absent.add(OWNER);
    await h.shop.reconcile(OWNER, h.goods.room);
    expect(h.gateway.rooms.get(channelId)?.allowUserIds).toEqual([]);
    h.gateway.absent.delete(OWNER);
    await h.shop.memberJoined(OWNER);
    await h.shop.idle();
    expect(h.gateway.rooms.get(channelId)?.allowUserIds).toEqual([OWNER]);
  });

  it('expiry deletes the channel', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);
    const channelId = (await testDb().personalRoom.findFirstOrThrow()).channelId ?? '';
    h.clock.advance(30 * DAY);
    await h.shop.expirePass(h.clock.now());
    await h.shop.idle();
    expect(h.gateway.rooms.has(channelId)).toBe(false);
    expect(h.gateway.deleted).toContain(channelId);
    expect(await h.rooms.forOwner(OWNER)).toBeNull();
  });
});
