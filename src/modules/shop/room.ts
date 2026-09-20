// Personal rooms (decision 014 §3.3): the owner changes the room only through the bot. Every
// change is a database write, then convergence of the owner's key rewrites the channel in full.
// Guests use the counter pattern, like clan seats.
import { systemClock, type Clock } from '../../core/clock.js';
import { DomainError, isDomainError, type DomainErrorCode } from '../../core/errors.js';
import { isFakeUserId } from '../../core/match.js';
import type { GuildGateway } from '../../core/ports.js';
import type { Db } from '../../db/client.js';
import { withTx } from '../../db/tx.js';
import type { LoggingService } from '../logging/service.js';
import { Capability, createPermissionsService, dbPermissionSources, type MemberFacts, type PermissionsService } from '../permissions/service.js';
import { nameProblem, normalizeName } from './names.js';
import type { ShopService } from './service.js';

/** The limits the panel offers; 0 = no limit (014 §3.3). */
export const ROOM_LIMITS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25] as const;
export const MAX_GUESTS = 25;
/** How long a guest removal waits for the overwrite to go before disconnecting them. */
const REMOVE_WAIT_MS = 8_000;

export interface RoomView {
  roomId: number;
  purchaseId: number;
  goodId: number;
  /** Whose room it is; an administrator may be looking at someone else's (decision 024 §4). */
  ownerId: string;
  name: string;
  channelId: string | null;
  userLimit: number;
  locked: boolean;
  guestIds: string[];
  expiresAt: Date | null;
  applied: boolean;
}

/**
 * Every change takes the actor and the room's id, never «my room» (decision 024 §4): the panel's
 * buttons carry the room, so an administrator's press acts on the room they opened. Who may change
 * it is decided here — the room's owner, or a holder of SHOP_MANAGE.
 */
export interface RoomService {
  /** The room of the owner's ACTIVE purchase, or null. */
  forOwner(ownerId: string): Promise<RoomView | null>;
  /** Another player's room, for a holder of SHOP_MANAGE; their own needs no right (024 §4). */
  forPlayer(actor: MemberFacts, ownerId: string): Promise<RoomView | null>;
  /** The room behind a panel's id, if the actor may change it; NO_ROOM or NOT_ALLOWED otherwise. */
  forManager(actor: MemberFacts, roomId: number): Promise<RoomView>;
  update(actor: MemberFacts, roomId: number, patch: { name?: string; userLimit?: number; locked?: boolean }): Promise<RoomView>;
  addGuests(actor: MemberFacts, roomId: number, userIds: readonly string[]): Promise<{ added: string[]; refused: { userId: string; code: DomainErrorCode }[] }>;
  /** Also disconnects the guest if they sit in the room. */
  removeGuest(actor: MemberFacts, roomId: number, userId: string): Promise<void>;
}

export interface RoomDeps {
  db: Db;
  shop: Pick<ShopService, 'reconcile'>;
  logging: LoggingService;
  gateway: GuildGateway;
  /** Who may touch a room that is not theirs. Left out, one is built over the same `db`, as economy does. */
  permissions?: PermissionsService;
  clock?: Clock;
}

const mention = (userId: string) => `<@${userId}>`;

export function createRoomService(deps: RoomDeps): RoomService {
  const { db, shop, logging, gateway } = deps;
  const clock = deps.clock ?? systemClock;
  const permissions = deps.permissions ?? createPermissionsService(dbPermissionSources(db));

  const viewOf = (room: {
    id: number;
    purchaseId: number;
    ownerId: string;
    name: string;
    channelId: string | null;
    userLimit: number;
    locked: boolean;
    guests: { userId: string }[];
    purchase: { goodId: number; expiresAt: Date | null; appliedAt: Date | null };
  }): RoomView => ({
    roomId: room.id,
    purchaseId: room.purchaseId,
    goodId: room.purchase.goodId,
    ownerId: room.ownerId,
    name: room.name,
    channelId: room.channelId,
    userLimit: room.userLimit,
    locked: room.locked,
    guestIds: room.guests.map((g) => g.userId),
    expiresAt: room.purchase.expiresAt,
    applied: room.purchase.appliedAt !== null,
  });

  const include = { guests: { orderBy: { id: 'asc' } }, purchase: { select: { goodId: true, expiresAt: true, appliedAt: true } } } as const;

  async function load(ownerId: string): Promise<RoomView | null> {
    const room = await db.personalRoom.findFirst({ where: { ownerId, purchase: { status: 'ACTIVE' } }, include });
    return room ? viewOf(room) : null;
  }

  async function loadById(roomId: number): Promise<RoomView | null> {
    const room = await db.personalRoom.findFirst({ where: { id: roomId, purchase: { status: 'ACTIVE' } }, include });
    return room ? viewOf(room) : null;
  }

  /** The room, if the actor may change it: its owner, or SHOP_MANAGE (024 §4). */
  async function manageable(actor: MemberFacts, roomId: number): Promise<RoomView> {
    const room = await loadById(roomId);
    if (!room) throw new DomainError('NO_ROOM', `room ${roomId}`);
    if (room.ownerId !== actor.userId && !(await permissions.can(actor, Capability.SHOP_MANAGE))) {
      throw new DomainError('NOT_ALLOWED', `room ${roomId} of ${room.ownerId}`);
    }
    return room;
  }

  /**
   * The one log-channel line a change writes. The owner's own change reads as it always has; an
   * administrator's change names the administrator, the room's owner and what changed (024 §4).
   */
  const auditLine = (actor: MemberFacts, room: RoomView, what: string): string =>
    actor.userId === room.ownerId ? `🏠 Комната ${mention(room.ownerId)}: ${what}` : `🛠️ ${mention(actor.userId)} изменил комнату ${mention(room.ownerId)}: ${what}`;

  const service: RoomService = {
    forOwner: load,

    async forPlayer(actor, ownerId) {
      if (ownerId !== actor.userId && !(await permissions.can(actor, Capability.SHOP_MANAGE))) throw new DomainError('NOT_ALLOWED', `room of ${ownerId}`);
      return load(ownerId);
    },

    forManager: manageable,

    async update(actor, roomId, patch) {
      const room = await manageable(actor, roomId);
      const ownerId = room.ownerId;
      const data: { name?: string; userLimit?: number; locked?: boolean } = {};
      if (patch.name !== undefined) {
        const name = normalizeName(patch.name);
        const problem = nameProblem(name);
        if (problem) throw new DomainError('NAME_INVALID', `room name: ${problem}`, { reason: problem });
        data.name = name;
      }
      if (patch.userLimit !== undefined) {
        if (!(ROOM_LIMITS as readonly number[]).includes(patch.userLimit)) throw new DomainError('STALE_PANEL', `limit ${patch.userLimit}`);
        data.userLimit = patch.userLimit;
      }
      if (patch.locked !== undefined) data.locked = patch.locked;
      await db.personalRoom.update({ where: { id: room.roomId }, data });
      const what = [
        data.name !== undefined ? `название «${room.name}» → «${data.name}»` : null,
        data.userLimit !== undefined ? `лимит ${data.userLimit === 0 ? 'без ограничения' : data.userLimit}` : null,
        data.locked !== undefined ? (data.locked ? 'закрыта' : 'открыта для всех') : null,
      ].filter(Boolean);
      await logging.event('room.updated', { roomId: room.roomId, actorId: actor.userId, ownerId, ...data }, auditLine(actor, room, `${what.join(', ')}.`));
      await shop.reconcile(ownerId, room.goodId);
      return (await loadById(room.roomId)) ?? room;
    },

    async addGuests(actor, roomId, userIds) {
      const room = await manageable(actor, roomId);
      const ownerId = room.ownerId;
      const added: string[] = [];
      const refused: { userId: string; code: DomainErrorCode }[] = [];
      for (const userId of [...new Set(userIds)]) {
        if (userId === ownerId || isFakeUserId(userId)) {
          refused.push({ userId, code: 'INVALID_TARGET' });
          continue;
        }
        try {
          await withTx(db, async (tx) => {
            const seat = await tx.$queryRaw<{ id: number }[]>`
              UPDATE "PersonalRoom" SET "guestCount" = "guestCount" + 1
              WHERE "id" = ${room.roomId} AND "guestCount" < ${MAX_GUESTS} RETURNING "id"`;
            if (!seat[0]) throw new DomainError('ROOM_FULL', `room ${room.roomId}`);
            const inserted = await tx.$queryRaw<{ id: number }[]>`
              INSERT INTO "RoomGuest" ("roomId", "userId", "addedAt") VALUES (${room.roomId}, ${userId}, ${clock.now()})
              ON CONFLICT ("roomId", "userId") DO NOTHING RETURNING "id"`;
            if (!inserted[0]) throw new DomainError('ALREADY_JOINED', `guest ${userId}`);
          });
          added.push(userId);
        } catch (err) {
          if (!isDomainError(err)) throw err;
          refused.push({ userId, code: err.code });
          if (err.code === 'ROOM_FULL') break;
        }
      }
      if (added.length > 0) {
        await logging.event(
          'room.guests_added',
          { roomId: room.roomId, actorId: actor.userId, ownerId, added },
          actor.userId === ownerId
            ? `🏠 ${mention(ownerId)} пустил в свою комнату ${added.map(mention).join(', ')}.`
            : auditLine(actor, room, `пустил ${added.map(mention).join(', ')}.`),
        );
        await shop.reconcile(ownerId, room.goodId);
      }
      return { added, refused };
    },

    async removeGuest(actor, roomId, userId) {
      const room = await manageable(actor, roomId);
      const ownerId = room.ownerId;
      const removed = await withTx(db, async (tx) => {
        const deleted = await tx.$queryRaw<{ id: number }[]>`
          DELETE FROM "RoomGuest" WHERE "roomId" = ${room.roomId} AND "userId" = ${userId} RETURNING "id"`;
        if (!deleted[0]) return false;
        await tx.$executeRaw`UPDATE "PersonalRoom" SET "guestCount" = "guestCount" - 1 WHERE "id" = ${room.roomId} AND "guestCount" > 0`;
        return true;
      });
      if (!removed) throw new DomainError('NOT_A_MEMBER', `guest ${userId} room ${room.roomId}`);
      await logging.event(
        'room.guest_removed',
        { roomId: room.roomId, actorId: actor.userId, ownerId, userId },
        actor.userId === ownerId ? `🏠 ${mention(ownerId)} убрал ${mention(userId)} из своей комнаты.` : auditLine(actor, room, `убрал ${mention(userId)}.`),
      );
      // The overwrite goes first, then the guest is taken out of the channel (014 §3.3).
      await Promise.race([shop.reconcile(ownerId, room.goodId), new Promise((r) => setTimeout(r, REMOVE_WAIT_MS).unref())]);
      if (room.channelId) await gateway.disconnect(userId, room.channelId).catch(() => undefined);
    },
  };
  return service;
}
