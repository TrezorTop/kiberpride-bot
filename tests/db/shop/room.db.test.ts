// Personal rooms (decision 014 §3.3, 015 §5): created locked in the chosen category, controlled
// only through the bot, guests under concurrency, a removed guest disconnected, expiry. Since
// decision 024 §4 an administrator with SHOP_MANAGE changes someone else's room the same way, and
// only their changes name an actor in the log channel.
import { describe, expect, it } from 'vitest';
import { testDb } from '../helpers.js';
import { ADMIN, buyer, DAY, expectShopInvariants, fund, player, ROOM_CATEGORY, shopHarness } from './harness.js';

const OWNER = buyer(1);
const ME = player(OWNER);

/** The room id the panel's buttons carry. */
async function roomIdOf(ownerId: string): Promise<number> {
  return (await testDb().personalRoom.findFirstOrThrow({ where: { ownerId } })).id;
}

describe('personal room', () => {
  it('is created locked in the category with the owner let in, and survives a renewal', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 20_000);
    const r = await h.shop.buy(OWNER, h.goods.room, 0, { roomName: '🏠 Комната Васи' });
    expect(r.applied).toBe(true);
    const view = await h.rooms.forOwner(OWNER);
    const channel = h.gateway.rooms.get(view?.channelId ?? '');
    expect(channel).toMatchObject({ name: '🏠 Комната Васи', categoryId: ROOM_CATEGORY, locked: true, userLimit: 0, allowUserIds: [OWNER] });
    expect(view?.ownerId).toBe(OWNER);

    await h.shop.buy(OWNER, h.goods.room, 1);
    await h.shop.idle();
    expect(h.gateway.roomCreates).toHaveLength(1);
    await expectShopInvariants();
  });

  it('the owner renames, limits and opens it through the bot; bad input is refused', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0, { roomName: 'Комната' });
    const roomId = await roomIdOf(OWNER);
    await h.rooms.update(ME, roomId, { name: 'Штаб 🎧', userLimit: 5, locked: false });
    const view = await h.rooms.forOwner(OWNER);
    expect(h.gateway.rooms.get(view?.channelId ?? '')).toMatchObject({ name: 'Штаб 🎧', userLimit: 5, locked: false });
    await expect(h.rooms.update(ME, roomId, { userLimit: 11 })).rejects.toMatchObject({ code: 'STALE_PANEL' });
    await expect(h.rooms.update(ME, roomId, { name: '#канал' })).rejects.toMatchObject({ code: 'NAME_INVALID' });
    await expect(h.rooms.update(ME, roomId + 1000, { locked: true })).rejects.toMatchObject({ code: 'NO_ROOM' });
  });

  it('thirty concurrent invitations fill 25 seats exactly; the counter equals the rows', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);
    const roomId = await roomIdOf(OWNER);
    const guests = Array.from({ length: 30 }, (_, i) => buyer(100 + i));
    const results = await Promise.all(guests.map((g) => h.rooms.addGuests(ME, roomId, [g])));
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
    const roomId = await roomIdOf(OWNER);
    await h.rooms.addGuests(ME, roomId, [guest, OWNER]);
    const view = await h.rooms.forOwner(OWNER);
    const channelId = view?.channelId ?? '';
    expect(h.gateway.rooms.get(channelId)?.allowUserIds).toEqual([OWNER, guest]);

    await h.rooms.removeGuest(ME, roomId, guest);
    expect(h.gateway.rooms.get(channelId)?.allowUserIds).toEqual([OWNER]);
    expect(h.gateway.disconnects).toEqual([{ userId: guest, channelId }]);
    await expect(h.rooms.removeGuest(ME, roomId, guest)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
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

// ─── /комната <игрок> for an administrator (decision 024 §4) ────────────────

describe('an administrator on someone else`s room (024 §4)', () => {
  it('renames it, locks it and adds a guest, and every change sticks', async () => {
    const h = await shopHarness();
    const guest = buyer(3);
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0, { roomName: 'Комната' });
    const roomId = await roomIdOf(OWNER);

    const renamed = await h.rooms.update(ADMIN, roomId, { name: 'Переименовано', locked: true });
    expect(renamed).toMatchObject({ name: 'Переименовано', locked: true, ownerId: OWNER });
    await h.rooms.addGuests(ADMIN, roomId, [guest]);
    await h.rooms.update(ADMIN, roomId, { userLimit: 5 });
    await h.shop.idle();

    const view = await h.rooms.forOwner(OWNER);
    expect(view).toMatchObject({ name: 'Переименовано', locked: true, userLimit: 5, guestIds: [guest] });
    expect(h.gateway.rooms.get(view?.channelId ?? '')).toMatchObject({ name: 'Переименовано', userLimit: 5, locked: true, allowUserIds: [OWNER, guest] });

    await h.rooms.removeGuest(ADMIN, roomId, guest);
    expect((await h.rooms.forOwner(OWNER))?.guestIds).toEqual([]);
    await expectShopInvariants();
  });

  it('opens the panel of another player through forPlayer, and their own without any right', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);

    expect(await h.rooms.forPlayer(ADMIN, OWNER)).toMatchObject({ ownerId: OWNER });
    expect(await h.rooms.forPlayer(ME, OWNER)).toMatchObject({ ownerId: OWNER });
    expect(await h.rooms.forPlayer(ADMIN, buyer(7))).toBeNull();
    await expect(h.rooms.forPlayer(player(buyer(7)), OWNER)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
  });

  it('a role granted SHOP_MANAGE may manage a room too (the right is data, not the command)', async () => {
    const h = await shopHarness();
    await testDb().roleCapability.create({ data: { roleId: '800000000000000002', capability: 'SHOP_MANAGE' } });
    const moderator = { userId: buyer(8), roleIds: ['800000000000000002'], isGuildOwner: false, isAdministrator: false };
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0);
    const roomId = await roomIdOf(OWNER);

    await expect(h.rooms.update(moderator, roomId, { locked: false })).resolves.toMatchObject({ locked: false });
  });

  it('a player without the right changes nothing on a room that is not theirs', async () => {
    const h = await shopHarness();
    const stranger = player(buyer(4));
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0, { roomName: 'Комната' });
    const roomId = await roomIdOf(OWNER);
    const before = h.logging.events.length;

    await expect(h.rooms.update(stranger, roomId, { name: 'Моё' })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(h.rooms.addGuests(stranger, roomId, [buyer(5)])).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(h.rooms.removeGuest(stranger, roomId, OWNER)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(h.rooms.forManager(stranger, roomId)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });

    expect(await h.rooms.forOwner(OWNER)).toMatchObject({ name: 'Комната', guestIds: [] });
    expect(h.logging.events.length).toBe(before);
    await expectShopInvariants();
  });

  it('only an administrator`s change names an actor in the log channel', async () => {
    const h = await shopHarness();
    await fund(h, OWNER, 10_000);
    await h.shop.buy(OWNER, h.goods.room, 0, { roomName: 'Комната' });
    const roomId = await roomIdOf(OWNER);

    await h.rooms.update(ME, roomId, { name: 'Своё название' });
    const own = h.logging.events.filter((e) => e.name === 'room.updated');
    expect(own).toHaveLength(1);
    expect(own[0]?.audit).not.toContain(`<@${ADMIN.userId}>`);
    expect(own[0]?.audit).toContain(`<@${OWNER}>`);

    await h.rooms.update(ADMIN, roomId, { name: 'Админское название', locked: false });
    const byAdmin = h.logging.events.filter((e) => e.name === 'room.updated')[1];
    expect(byAdmin?.fields).toMatchObject({ actorId: ADMIN.userId, ownerId: OWNER });
    expect(byAdmin?.audit).toContain(`<@${ADMIN.userId}>`);
    expect(byAdmin?.audit).toContain(`<@${OWNER}>`);
    expect(byAdmin?.audit).toContain('Админское название');

    await h.rooms.addGuests(ADMIN, roomId, [buyer(6)]);
    const added = h.logging.events.find((e) => e.name === 'room.guests_added');
    expect(added?.audit).toContain(`<@${ADMIN.userId}>`);
    await h.rooms.removeGuest(ADMIN, roomId, buyer(6));
    const removed = h.logging.events.find((e) => e.name === 'room.guest_removed');
    expect(removed?.audit).toContain(`<@${ADMIN.userId}>`);
  });
});
