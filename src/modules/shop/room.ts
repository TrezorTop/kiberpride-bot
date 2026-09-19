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
  name: string;
  channelId: string | null;
  userLimit: number;
  locked: boolean;
  guestIds: string[];
  expiresAt: Date | null;
  applied: boolean;
}

export interface RoomService {
  /** The room of the owner's ACTIVE purchase, or null. */
  forOwner(ownerId: string): Promise<RoomView | null>;
  update(ownerId: string, patch: { name?: string; userLimit?: number; locked?: boolean }): Promise<RoomView>;
  addGuests(ownerId: string, userIds: readonly string[]): Promise<{ added: string[]; refused: { userId: string; code: DomainErrorCode }[] }>;
  /** Also disconnects the guest if they sit in the room. */
  removeGuest(ownerId: string, userId: string): Promise<void>;
}

export interface RoomDeps {
  db: Db;
  shop: Pick<ShopService, 'reconcile'>;
  logging: LoggingService;
  gateway: GuildGateway;
  clock?: Clock;
}

const mention = (userId: string) => `<@${userId}>`;

export function createRoomService(deps: RoomDeps): RoomService {
  const { db, shop, logging, gateway } = deps;
  const clock = deps.clock ?? systemClock;

  async function load(ownerId: string): Promise<RoomView | null> {
    const room = await db.personalRoom.findFirst({
      where: { ownerId, purchase: { status: 'ACTIVE' } },
      include: { guests: { orderBy: { id: 'asc' } }, purchase: { select: { goodId: true, expiresAt: true, appliedAt: true } } },
    });
    if (!room) return null;
    return {
      roomId: room.id,
      purchaseId: room.purchaseId,
      goodId: room.purchase.goodId,
      name: room.name,
      channelId: room.channelId,
      userLimit: room.userLimit,
      locked: room.locked,
      guestIds: room.guests.map((g) => g.userId),
      expiresAt: room.purchase.expiresAt,
      applied: room.purchase.appliedAt !== null,
    };
  }

  async function owned(ownerId: string): Promise<RoomView> {
    const room = await load(ownerId);
    if (!room) throw new DomainError('NO_ROOM', `user ${ownerId}`);
    return room;
  }

  const service: RoomService = {
    forOwner: load,

    async update(ownerId, patch) {
      const room = await owned(ownerId);
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
      await logging.event('room.updated', { roomId: room.roomId, ownerId, ...data }, `🏠 Комната ${mention(ownerId)}: ${what.join(', ')}.`);
      await shop.reconcile(ownerId, room.goodId);
      return (await load(ownerId)) ?? room;
    },

    async addGuests(ownerId, userIds) {
      const room = await owned(ownerId);
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
        await logging.event('room.guests_added', { roomId: room.roomId, ownerId, added }, `🏠 ${mention(ownerId)} пустил в свою комнату ${added.map(mention).join(', ')}.`);
        await shop.reconcile(ownerId, room.goodId);
      }
      return { added, refused };
    },

    async removeGuest(ownerId, userId) {
      const room = await owned(ownerId);
      const removed = await withTx(db, async (tx) => {
        const deleted = await tx.$queryRaw<{ id: number }[]>`
          DELETE FROM "RoomGuest" WHERE "roomId" = ${room.roomId} AND "userId" = ${userId} RETURNING "id"`;
        if (!deleted[0]) return false;
        await tx.$executeRaw`UPDATE "PersonalRoom" SET "guestCount" = "guestCount" - 1 WHERE "id" = ${room.roomId} AND "guestCount" > 0`;
        return true;
      });
      if (!removed) throw new DomainError('NOT_A_MEMBER', `guest ${userId} room ${room.roomId}`);
      await logging.event('room.guest_removed', { roomId: room.roomId, ownerId, userId }, `🏠 ${mention(ownerId)} убрал ${mention(userId)} из своей комнаты.`);
      // The overwrite goes first, then the guest is taken out of the channel (014 §3.3).
      await Promise.race([shop.reconcile(ownerId, room.goodId), new Promise((r) => setTimeout(r, REMOVE_WAIT_MS).unref())]);
      if (room.channelId) await gateway.disconnect(userId, room.channelId).catch(() => undefined);
    },
  };
  return service;
}
