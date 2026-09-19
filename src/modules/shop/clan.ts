// Clans (decisions 014 §3.2, 015 §3): the buyer plus up to `maxMembers`, one clan per person.
// Every membership change locks the players' User rows first (ascending), then the Clan row: a
// buy of a clan takes the same User lock, so «add X to my clan» and «X buys a clan» serialise.
// Seats use the counter pattern — a guarded increment plus an insert whose conflict rolls the
// counter back. Discord follows through the shop's convergence of the owner's key.
import { systemClock, type Clock } from '../../core/clock.js';
import { DomainError, isDomainError, type DomainErrorCode } from '../../core/errors.js';
import { isFakeUserId } from '../../core/match.js';
import type { GuildGateway } from '../../core/ports.js';
import { isUniqueViolation, withTx } from '../../db/tx.js';
import type { Db, Tx } from '../../db/client.js';
import type { LoggingService } from '../logging/service.js';
import { clanRoleConfig, type ClanRoleConfig } from './kinds/clanRole.js';
import { nameProblem, normalizeName } from './names.js';
import type { ShopService } from './service.js';

export interface ClanView {
  clanId: number;
  purchaseId: number;
  goodId: number;
  name: string;
  color: number;
  /** The palette entry of the colour, when it is still in the palette. */
  colorLabel: string | null;
  ownerId: string;
  memberIds: string[];
  maxMembers: number;
  expiresAt: Date | null;
  applied: boolean;
  isOwner: boolean;
  palette: ClanRoleConfig['palette'];
}

export interface AddOutcome {
  added: string[];
  refused: { userId: string; code: DomainErrorCode }[];
}

export interface ClanService {
  /** The open clan the player owns or belongs to, or null. */
  forUser(userId: string): Promise<ClanView | null>;
  addMembers(ownerId: string, userIds: readonly string[]): Promise<AddOutcome>;
  removeMember(ownerId: string, userId: string): Promise<void>;
  leave(userId: string): Promise<void>;
  restyle(ownerId: string, input: { name: string; colorIndex: number }): Promise<ClanView>;
}

export interface ClanDeps {
  db: Db;
  shop: Pick<ShopService, 'reconcile'>;
  logging: LoggingService;
  gateway: GuildGateway;
  clock?: Clock;
}

const mention = (userId: string) => `<@${userId}>`;

export function createClanService(deps: ClanDeps): ClanService {
  const { db, shop, logging, gateway } = deps;
  const clock = deps.clock ?? systemClock;

  async function load(where: { ownerId: string } | { memberId: string }): Promise<ClanView | null> {
    const clan = await db.clan.findFirst({
      where: { closedAt: null, ...('ownerId' in where ? { ownerId: where.ownerId } : { members: { some: { userId: where.memberId } } }) },
      include: { members: { orderBy: { id: 'asc' } }, purchase: { include: { good: true } } },
    });
    if (!clan) return null;
    const parsed = clanRoleConfig.safeParse(clan.purchase.good.config);
    const config = parsed.success ? parsed.data : null;
    return {
      clanId: clan.id,
      purchaseId: clan.purchaseId,
      goodId: clan.purchase.goodId,
      name: clan.name,
      color: clan.color,
      colorLabel: config?.palette.find((p) => p.rgb === clan.color)?.label ?? null,
      ownerId: clan.ownerId,
      memberIds: clan.members.map((m) => m.userId),
      maxMembers: config?.maxMembers ?? 10,
      expiresAt: clan.purchase.expiresAt,
      applied: clan.purchase.appliedAt !== null,
      isOwner: 'ownerId' in where,
      palette: config?.palette ?? [],
    };
  }

  async function owned(ownerId: string): Promise<ClanView> {
    const clan = await load({ ownerId });
    if (!clan) {
      if (await load({ memberId: ownerId })) throw new DomainError('NOT_OWNER', `user ${ownerId} is a member, not the owner`);
      throw new DomainError('NO_CLAN', `user ${ownerId}`);
    }
    return clan;
  }

  async function lockUsers(tx: Tx, ids: readonly string[]): Promise<void> {
    const sorted = [...new Set(ids)].sort();
    for (const id of sorted) await tx.$executeRaw`INSERT INTO "User" ("id") VALUES (${id}) ON CONFLICT ("id") DO NOTHING`;
    for (const id of sorted) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
  }

  /** One seat, one transaction: a refusal of one player does not undo the others. */
  async function addOne(clan: ClanView, userId: string): Promise<void> {
    await withTx(db, async (tx) => {
      await lockUsers(tx, [userId]);
      const owns = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Clan" WHERE "ownerId" = ${userId} AND "closedAt" IS NULL LIMIT 1`;
      if (owns[0]) throw new DomainError('IN_OTHER_CLAN', `user ${userId} owns clan ${owns[0].id}`);
      const seat = await tx.$queryRaw<{ memberCount: number }[]>`
        UPDATE "Clan" SET "memberCount" = "memberCount" + 1
        WHERE "id" = ${clan.clanId} AND "closedAt" IS NULL AND "memberCount" < ${clan.maxMembers}
        RETURNING "memberCount"`;
      if (!seat[0]) {
        const open = await tx.clan.findUnique({ where: { id: clan.clanId }, select: { closedAt: true } });
        throw new DomainError(open?.closedAt === null ? 'CLAN_FULL' : 'NO_CLAN', `clan ${clan.clanId}`);
      }
      // ClanMember.userId is unique across clans (Q15): the conflict rolls the seat back.
      const inserted = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO "ClanMember" ("clanId", "userId", "addedAt") VALUES (${clan.clanId}, ${userId}, ${clock.now()})
        ON CONFLICT DO NOTHING RETURNING "id"`;
      if (!inserted[0]) {
        const here = await tx.clanMember.findUnique({ where: { userId }, select: { clanId: true } });
        throw new DomainError(here?.clanId === clan.clanId ? 'ALREADY_JOINED' : 'IN_OTHER_CLAN', `user ${userId}`);
      }
    });
  }

  async function removeTx(clanId: number, userId: string): Promise<boolean> {
    return withTx(db, async (tx) => {
      await lockUsers(tx, [userId]);
      const deleted = await tx.$queryRaw<{ id: number }[]>`
        DELETE FROM "ClanMember" WHERE "clanId" = ${clanId} AND "userId" = ${userId} RETURNING "id"`;
      if (!deleted[0]) return false;
      await tx.$executeRaw`UPDATE "Clan" SET "memberCount" = "memberCount" - 1 WHERE "id" = ${clanId} AND "memberCount" > 0`;
      return true;
    });
  }

  return {
    async forUser(userId) {
      return (await load({ ownerId: userId })) ?? (await load({ memberId: userId }));
    },

    async addMembers(ownerId, userIds) {
      const clan = await owned(ownerId);
      const out: AddOutcome = { added: [], refused: [] };
      for (const userId of [...new Set(userIds)]) {
        if (userId === ownerId || isFakeUserId(userId)) {
          out.refused.push({ userId, code: 'INVALID_TARGET' });
          continue;
        }
        try {
          await addOne(clan, userId);
          out.added.push(userId);
        } catch (err) {
          if (!isDomainError(err)) throw err;
          out.refused.push({ userId, code: err.code });
          if (err.code === 'CLAN_FULL' || err.code === 'NO_CLAN') break;
        }
      }
      if (out.added.length > 0) {
        await logging.event(
          'clan.members_added',
          { clanId: clan.clanId, ownerId, added: out.added },
          `🛡️ Клан «${clan.name}»: ${mention(ownerId)} добавил ${out.added.map(mention).join(', ')}.`,
        );
        void shop.reconcile(ownerId, clan.goodId);
      }
      return out;
    },

    async removeMember(ownerId, userId) {
      const clan = await owned(ownerId);
      if (!(await removeTx(clan.clanId, userId))) throw new DomainError('NOT_A_MEMBER', `user ${userId} clan ${clan.clanId}`);
      await logging.event('clan.member_removed', { clanId: clan.clanId, ownerId, userId }, `🛡️ Клан «${clan.name}»: ${mention(ownerId)} убрал ${mention(userId)}.`);
      void shop.reconcile(ownerId, clan.goodId);
    },

    async leave(userId) {
      const clan = await load({ memberId: userId });
      if (!clan) throw new DomainError((await load({ ownerId: userId })) ? 'NOT_A_MEMBER' : 'NO_CLAN', `user ${userId}`);
      if (!(await removeTx(clan.clanId, userId))) throw new DomainError('NO_CLAN', `user ${userId}`);
      await logging.event('clan.member_left', { clanId: clan.clanId, userId }, `🚪 ${mention(userId)} вышел из клана «${clan.name}».`);
      void shop.reconcile(clan.ownerId, clan.goodId);
    },

    async restyle(ownerId, input) {
      const clan = await owned(ownerId);
      const good = await db.shopGood.findUnique({ where: { id: clan.goodId } });
      const config = clanRoleConfig.safeParse(good?.config);
      if (!config.success) throw new DomainError('SHOP_UNAVAILABLE', `good ${clan.goodId}: bad config`);
      const colour = config.data.palette[input.colorIndex];
      if (!colour) throw new DomainError('STALE_PANEL', `colour ${input.colorIndex}`);
      const name = normalizeName(input.name);
      // The clan's own role may carry its current name; it does not count as taken.
      const roleNames = (await gateway.guildRoleNames()).filter((r) => r.toLocaleLowerCase('ru') !== clan.name.toLocaleLowerCase('ru'));
      const problem = nameProblem(name, { forbiddenWords: config.data.forbiddenWords, roleNames });
      if (problem) throw new DomainError('NAME_INVALID', `clan name: ${problem}`, { reason: problem });

      try {
        await db.clan.update({ where: { id: clan.clanId, closedAt: null }, data: { name, color: colour.rgb } });
      } catch (err) {
        if (isUniqueViolation(err)) throw new DomainError('NAME_TAKEN', `clan name ${name}`);
        throw err;
      }
      const row = await db.clan.findUniqueOrThrow({ where: { id: clan.clanId }, select: { roleId: true } });
      // An explicit rename is the one time the name and colour are written onto the role (014 §3.2);
      // a clan whose role does not exist yet gets them when convergence creates it.
      if (row.roleId) {
        await gateway.ensureRole({
          currentId: row.roleId,
          name,
          color: colour.rgb,
          restyle: true,
          adoptByName: false,
          belowRoleId: config.data.anchorRoleId,
          reason: `KiberPride Bot: clan #${clan.clanId} renamed by its owner`,
        });
      }
      await logging.event(
        'clan.restyled',
        { clanId: clan.clanId, ownerId, from: clan.name, to: name, color: colour.rgb },
        `✏️ ${mention(ownerId)} переименовал клан: «${clan.name}» → «${name}» (${colour.label}).`,
      );
      void shop.reconcile(ownerId, clan.goodId);
      return (await load({ ownerId })) ?? clan;
    },
  };
}
