// The room panel's buttons and selects gained the room's id on this branch (decision 024 §4), so
// an ephemeral panel a player opened BEFORE the deploy still sits in their Discord client with the
// old ids. An old press must be refused, never decoded as a room number: `rmlock:1` used to mean
// «закрыть», and under the new shape it reads as room #1 — someone else's — with no flag at all
// (architect review 2026-09-20, M2).
import { describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../../modules/shop/room.js';
import { decodeCustomId } from '../customId.js';
import { roomRenameModal } from '../modals/shop.js';
import { roomAddSelect, roomLimitSelect, roomRemoveSelect } from '../selects/shop.js';
import { roomLockButton, roomRenameButton } from './shop.js';

const PRESSER = '300000000000000001';
const OTHER = '300000000000000002';

const room = (over: Partial<RoomView> = {}): RoomView => ({
  roomId: 7,
  purchaseId: 5,
  goodId: 3,
  ownerId: PRESSER,
  name: 'Штаб',
  channelId: '400000000000000001',
  userLimit: 0,
  locked: false,
  guestIds: [],
  expiresAt: null,
  applied: true,
  ...over,
});

/** Enough of an interaction for `actorOf` and `editReply`; nothing else is reached. */
function fakeInteraction(over: Record<string, unknown> = {}) {
  return {
    user: { id: PRESSER },
    guild: { ownerId: OTHER },
    inCachedGuild: () => true,
    member: { roles: { cache: new Map() }, permissions: { has: () => false } },
    editReply: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

function fakeRooms() {
  return {
    forOwner: vi.fn(() => Promise.resolve(room())),
    forPlayer: vi.fn(() => Promise.resolve(room())),
    forManager: vi.fn(() => Promise.resolve(room())),
    update: vi.fn(() => Promise.resolve(room())),
    addGuests: vi.fn(() => Promise.resolve({ added: [], refused: [] })),
    removeGuest: vi.fn(() => Promise.resolve()),
  };
}

type Rooms = ReturnType<typeof fakeRooms>;
type Pressable = { run: (interaction: never, args: string[], ctx: never) => Promise<void> };

/** Presses a button, a select or a modal exactly as the router would: by its custom_id. */
async function press(route: unknown, customId: string, ctx: { rooms: Rooms }, over: Record<string, unknown> = {}): Promise<void> {
  const decoded = decodeCustomId(customId);
  expect(decoded).not.toBeNull();
  const run = (route as Pressable).run as unknown as (i: unknown, args: string[], c: unknown) => Promise<void>;
  await run(fakeInteraction(over), decoded?.args ?? [], ctx);
}

describe('🔒 Закрыть / 🔓 Открыть комнату (kp1:rmlock)', () => {
  it('refuses a pre-deploy id instead of reading it as room #1', async () => {
    const ctx = { rooms: fakeRooms() };
    // The old shape was `kp1:rmlock:<1|0>`: «закрыть» is the dangerous half, because 1 is also a
    // valid room id and the missing flag used to read as «открыть для всех».
    await expect(press(roomLockButton, 'kp1:rmlock:1', ctx)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    await expect(press(roomLockButton, 'kp1:rmlock:0', ctx)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect(ctx.rooms.update).not.toHaveBeenCalled();
  });

  it('refuses a flag that is neither 0 nor 1', async () => {
    const ctx = { rooms: fakeRooms() };
    await expect(press(roomLockButton, 'kp1:rmlock:7:x', ctx)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect(ctx.rooms.update).not.toHaveBeenCalled();
  });

  it('acts on the room its own id names, in the direction the flag says', async () => {
    const ctx = { rooms: fakeRooms() };
    await press(roomLockButton, 'kp1:rmlock:7:1', ctx);
    expect(ctx.rooms.update).toHaveBeenLastCalledWith(expect.objectContaining({ userId: PRESSER }), 7, { locked: true });

    await press(roomLockButton, 'kp1:rmlock:7:0', ctx);
    expect(ctx.rooms.update).toHaveBeenLastCalledWith(expect.objectContaining({ userId: PRESSER }), 7, { locked: false });
  });
});

describe('the other room ids that changed shape on this branch (024 §4)', () => {
  // None of these can decode into a valid new id — they carried no argument at all, and `idArg`
  // refuses an absent one — but the refusal is asserted so it stays true.
  const cases: [string, unknown, string, Record<string, unknown>][] = [
    ['✏️ Название', roomRenameButton, 'kp1:rmname', {}],
    ['👥 Мест в комнате', roomLimitSelect, 'kp1:rmlim', { values: ['5'] }],
    ['➕ Пустить в комнату', roomAddSelect, 'kp1:rmadd', { isUserSelectMenu: () => true, users: new Map() }],
    ['➖ Убрать гостя', roomRemoveSelect, 'kp1:rmrm', { values: [OTHER] }],
    ['the rename form', roomRenameModal, 'kp1:rmnamef', { fields: { getTextInputValue: () => 'Штаб' } }],
  ];

  it.each(cases)('%s refuses its pre-deploy id and touches no room', async (_name, route, customId, over) => {
    const ctx = { rooms: fakeRooms() };
    await expect(press(route, customId, ctx, over)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect(ctx.rooms.update).not.toHaveBeenCalled();
    expect(ctx.rooms.addGuests).not.toHaveBeenCalled();
    expect(ctx.rooms.removeGuest).not.toHaveBeenCalled();
    expect(ctx.rooms.forManager).not.toHaveBeenCalled();
  });
});
