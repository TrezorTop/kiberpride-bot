// The shop (decisions 014 §1–§4, §7, §9; 015). Money is decided in the database: a purchase is one
// transaction guarded by the partial unique index on ACTIVE (user, good), a renewal is one guarded
// UPDATE on the expected period count, a refund is one guarded UPDATE plus `refund:<id>`. Discord
// follows through convergence per (user, good) key in a coalescing queue; it never runs inside a
// transaction and can be replayed from any crash point.
import { setTimeout as sleep } from 'node:timers/promises';
import { systemClock, type Clock } from '../../core/clock.js';
import { DomainError, isDomainError } from '../../core/errors.js';
import { createKeyedQueue } from '../../core/keyedQueue.js';
import { isFakeUserId } from '../../core/match.js';
import type { GuildGateway } from '../../core/ports.js';
import { Prisma, type Db, type Tx } from '../../db/client.js';
import { withTx, withTxRetry } from '../../db/tx.js';
import { TxKind, type EconomyService } from '../economy/service.js';
import type { LoggingService } from '../logging/service.js';
import { mayUseDevTools } from '../permissions/devTools.js';
import { Capability, type MemberFacts, type PermissionsService } from '../permissions/service.js';
import { bindKind, type BoundKind, type GoodRecord, type GrantState, type KindEnv, type Problem } from './kinds/index.js';
import type { ClanRoleConfig } from './kinds/clanRole.js';
import { nameProblem, normalizeName } from './names.js';
import { problemsText } from './problems.js';

export const APPLY_WAIT_MS = 8_000;
/** `/выдать-товар`: the days an administrator may hand out at once (decision 024 §1). */
export const GRANT_DAYS_MIN = 1;
export const GRANT_DAYS_MAX = 365;
export const GRANT_DAYS_DEFAULT = 30;
export const REFUND_AFTER_MS = 30 * 60_000;
export const WARN_BEFORE_MS = 24 * 3_600_000;
export const DEV_EXPIRE_IN_MS = 2 * 60_000;

export interface GoodOffer {
  id: number;
  slug: string;
  name: string;
  description: string;
  price: number;
  kind: string;
  validityDays: number | null;
  /** What it grants, one line (the kind's `describe`). */
  line: string;
}

export interface GrantView {
  purchaseId: number;
  goodId: number;
  goodName: string;
  kind: string;
  periods: number;
  grantedAt: Date;
  expiresAt: Date | null;
  /** false = paid, Discord not confirmed yet: «⏳ выдаётся». */
  applied: boolean;
}

export interface ShopOverview {
  balance: number;
  /** Enabled goods, each with the player's ACTIVE grant of it if any. */
  goods: (GoodOffer & { grant: GrantView | null })[];
  /** Every ACTIVE grant of the player, disabled goods included. */
  grants: GrantView[];
  inClan: boolean;
  hasRoom: boolean;
}

/** new: first purchase · renew: extend · pending: paid, not applied yet · owned: forever, nothing to renew. */
export type QuoteMode = 'new' | 'renew' | 'pending' | 'owned';

export interface Quote {
  good: GoodOffer;
  mode: QuoteMode;
  price: number;
  balance: number;
  /** How many KP the player lacks; 0 when they can pay. */
  shortBy: number;
  /** The confirm button carries it: 0 for a new purchase (014 §1). */
  expectedPeriods: number;
  /** The end date after paying; null = forever. */
  expiresAt: Date | null;
  current: GrantView | null;
  /** A new clan asks for a name and a colour in a modal first. */
  clanForm: boolean;
  /** The colours a clan may pick; null for other kinds. */
  palette: ClanRoleConfig['palette'] | null;
}

export interface BuyInput {
  clan?: { name: string; colorIndex: number };
  /** The room's first name; the owner renames it in the panel. */
  roomName?: string;
}

export interface BuyResult {
  purchaseId: number;
  goodName: string;
  kind: string;
  periods: number;
  renewed: boolean;
  expiresAt: Date | null;
  /** false = paid, but Discord did not confirm within the wait: «доступ появится…». */
  applied: boolean;
  balanceAfter: number;
}

export interface GoodAdminView {
  good: GoodRecord;
  line: string;
  problems: Problem[];
  warnings: Problem[];
}

/** One line of the `/отозвать` screen: an ACTIVE purchase of the chosen player (decision 023 §1). */
export interface RevokeItem {
  purchaseId: number;
  goodId: number;
  goodName: string;
  kind: string;
  /** The panel carries it as the guard value; a renewal in between makes the panel stale. */
  periods: number;
  /** The running total of every period paid — what «вернуть монеты» gives back (023 §3). */
  pricePaid: number;
  expiresAt: Date | null;
  applied: boolean;
}

export interface RevokeInput {
  purchaseId: number;
  /** The period count the panel showed (014 §1): anything else means the purchase changed. */
  expectedPeriods: number;
  /** The administrator's choice between the two buttons (023 §1). */
  refund: boolean;
}

export interface RevokeResult {
  purchaseId: number;
  userId: string;
  goodName: string;
  kind: string;
  /** null = taken back without a refund; a number = the KP Coin that went back. */
  refunded: number | null;
  /** The player's balance after the refund; null when nothing moved. */
  balanceAfter: number | null;
  /** false = Discord did not confirm within the wait: «уберётся в течение пары минут». */
  cleaned: boolean;
  /** false = the player's private messages are closed, so the administrator must tell them. */
  notified: boolean;
}

/** `/выдать-товар`: what an administrator hands out (decision 024 §1). No KP Coin move at all. */
export interface GrantByAdminInput {
  userId: string;
  goodId: number;
  /** GRANT_DAYS_MIN..GRANT_DAYS_MAX; the administrator's choice, 30 by default (024 §1). */
  days: number;
  /** A new clan needs its name and colour, exactly as a purchase does; ignored when extending. */
  clan?: { name: string; colorIndex: number };
  /** The room's first name, as `buy` takes it; the owner renames it in the panel. */
  roomName?: string;
  /** Only Discord knows this; a bot owns nothing. */
  targetIsBot?: boolean;
}

export interface GrantByAdminResult {
  purchaseId: number;
  userId: string;
  goodName: string;
  kind: string;
  days: number;
  periods: number;
  /** true = the player already had it and the days were added to what was left. */
  extended: boolean;
  expiresAt: Date;
  /** false = Discord did not confirm within the wait: «появится в течение пары минут». */
  applied: boolean;
  /** false = the player's private messages are closed, so the administrator must tell them. */
  notified: boolean;
}

export interface ShopService {
  overview(userId: string): Promise<ShopOverview>;
  grants(userId: string): Promise<GrantView[]>;
  quote(userId: string, goodId: number): Promise<Quote>;
  buy(userId: string, goodId: number, expectedPeriods: number, input?: BuyInput): Promise<BuyResult>;
  /** One convergence pass of the key, coalesced; resolves when a pass started after the call ends. */
  reconcile(userId: string, goodId: number): Promise<void>;
  /** Every key with an ACTIVE row or an uncleaned ended one (startup: repairs a lost queue). */
  reconcileAll(): Promise<number>;
  /** ACTIVE rows past their end → EXPIRED, clans closed, keys reconciled. Returns the purchase ids. */
  expirePass(now: Date): Promise<number[]>;
  /** Claims and sends the one warning a day before the end. Returns the purchase ids warned. */
  warnPass(now: Date): Promise<number[]>;
  /** Re-queues unapplied ACTIVE rows of present buyers and uncleaned ended rows. */
  retryPass(now: Date): Promise<number>;
  memberJoined(userId: string): Promise<void>;
  /** Frees the seats the player held in clans and rooms. */
  memberLeft(userId: string): Promise<void>;
  /** The goods as the shop settings screen shows them: problems from the cached checks. */
  adminList(actor: MemberFacts): Promise<GoodAdminView[]>;
  /** The good a command's choice names; null = it is not in the catalogue any more. */
  goodBySlug(slug: string): Promise<GoodRecord | null>;
  /** `/выдать-товар`: hands a good out without a purchase (SHOP_MANAGE; decision 024 §1). */
  grantByAdmin(actor: MemberFacts, input: GrantByAdminInput): Promise<GrantByAdminResult>;
  /** `/отозвать`: the player's ACTIVE purchases, for an administrator (SHOP_MANAGE; 023 §4). */
  revokeList(actor: MemberFacts, userId: string): Promise<RevokeItem[]>;
  /** Ends one purchase by hand, with or without giving the KP Coin back (decision 023). */
  revoke(actor: MemberFacts, input: RevokeInput): Promise<RevokeResult>;
  configure(actor: MemberFacts, goodId: number, patch: Record<string, unknown>): Promise<GoodAdminView>;
  setEnabled(actor: MemberFacts, goodId: number, enabled: boolean): Promise<GoodAdminView & { enabled: boolean }>;
  /** Startup: validate every enabled good, then reconcile everything (014 §4.3). */
  startup(): Promise<void>;
  /** «🧪 Закончить через 2 минуты» on the owner's own ACTIVE grant (014 §12). */
  devExpireSoon(actor: MemberFacts, purchaseId: number): Promise<Date>;
  idle(): Promise<void>;
}

export interface ShopDeps {
  db: Db;
  economy: EconomyService;
  permissions: PermissionsService;
  logging: LoggingService;
  gateway: GuildGateway;
  nodeEnv: string;
  clock?: Clock;
  applyWaitMs?: number;
  refundAfterMs?: number;
}

const grantInclude = {
  clan: { include: { members: { select: { userId: true }, orderBy: { id: 'asc' } } } },
  room: { include: { guests: { select: { userId: true }, orderBy: { id: 'asc' } } } },
} as const satisfies Prisma.PurchaseInclude;

type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof grantInclude }>;
type GoodRow = Prisma.ShopGoodGetPayload<object>;

const keyOf = (userId: string, goodId: number) => `${userId}:${goodId}`;
const mention = (userId: string) => `<@${userId}>`;

export function toGoodRecord(row: GoodRow): GoodRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    price: row.price,
    kind: row.kind,
    config: row.config,
    validityDays: row.validityDays,
    enabled: row.enabled,
  };
}

function stateOf(row: PurchaseRow): GrantState {
  return {
    purchaseId: row.id,
    userId: row.userId,
    goodId: row.goodId,
    clan: row.clan
      ? {
          id: row.clan.id,
          name: row.clan.name,
          color: row.clan.color,
          roleId: row.clan.roleId,
          ownerId: row.clan.ownerId,
          memberIds: row.clan.members.map((m) => m.userId),
        }
      : null,
    room: row.room
      ? {
          id: row.room.id,
          name: row.room.name,
          channelId: row.room.channelId,
          userLimit: row.room.userLimit,
          locked: row.room.locked,
          ownerId: row.room.ownerId,
          guestIds: row.room.guests.map((g) => g.userId),
        }
      : null,
  };
}

/** Error text with the Discord code when there is one; never a token (discord.js errors carry none). */
export function errorSummary(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e?.code === 'number' || typeof e?.code === 'string' ? ` (код ${String(e.code)})` : '';
  const message = typeof e?.message === 'string' ? e.message : String(err);
  return `${message.slice(0, 200)}${code}`;
}

const days = (n: number) => n * 86_400_000;

/**
 * Closes the clans of these purchases: the name and the members are free again (014 §3.2).
 * Lock order (017 §3): the Clan rows, ascending, then their members — as removal and leaving do.
 */
export async function closeClans(tx: Tx, purchaseIds: readonly number[], now: Date): Promise<number[]> {
  if (purchaseIds.length === 0) return [];
  await tx.$queryRaw`SELECT "id" FROM "Clan" WHERE "purchaseId" IN (${Prisma.join(purchaseIds)}) AND "closedAt" IS NULL ORDER BY "id" FOR UPDATE`;
  const closed = await tx.$queryRaw<{ id: number }[]>`
    UPDATE "Clan" SET "closedAt" = ${now}, "memberCount" = 0
    WHERE "purchaseId" IN (${Prisma.join(purchaseIds)}) AND "closedAt" IS NULL
    RETURNING "id"`;
  if (closed.length > 0) {
    await tx.$executeRaw`DELETE FROM "ClanMember" WHERE "clanId" IN (${Prisma.join(closed.map((c) => c.id))})`;
  }
  return closed.map((c) => c.id);
}

export function createShopService(deps: ShopDeps): ShopService {
  const { db, economy, permissions, logging, gateway } = deps;
  const clock = deps.clock ?? systemClock;
  const applyWaitMs = deps.applyWaitMs ?? APPLY_WAIT_MS;
  const refundAfterMs = deps.refundAfterMs ?? REFUND_AFTER_MS;
  const revokeFailuresReported = new Set<number>();

  const env: KindEnv = {
    gateway,
    async saveGoodConfig(goodId, patch) {
      // jsonb `||` merges top-level keys, so a concurrent settings save of another key survives.
      await db.$executeRaw`UPDATE "ShopGood" SET "config" = "config" || ${JSON.stringify(patch)}::jsonb, "updatedAt" = now() WHERE "id" = ${goodId}`;
    },
    async saveClanRole(clanId, roleId) {
      await db.clan.update({ where: { id: clanId }, data: { roleId } });
    },
    async saveRoomChannel(roomId, channelId) {
      await db.personalRoom.update({ where: { id: roomId }, data: { channelId } });
    },
    async claimedRoomChannels(exceptRoomId) {
      const rows = await db.personalRoom.findMany({ where: { id: { not: exceptRoomId }, channelId: { not: null } }, select: { channelId: true } });
      return rows.map((r) => r.channelId).filter((id): id is string => id !== null);
    },
  };

  const queue = createKeyedQueue<string>(
    (key) => {
      const [userId, goodId] = key.split(':');
      return pass(userId as string, Number(goodId));
    },
    (key, err) => {
      void logging.failure('shop.reconcile_failed', { key, err });
    },
  );

  async function loadGood(goodId: number): Promise<GoodRecord | null> {
    const row = await db.shopGood.findUnique({ where: { id: goodId } });
    return row ? toGoodRecord(row) : null;
  }

  function offerOf(good: GoodRecord, bound: BoundKind | null): GoodOffer {
    return {
      id: good.id,
      slug: good.slug,
      name: good.name,
      description: good.description,
      price: good.price,
      kind: good.kind,
      validityDays: good.validityDays,
      line: bound?.describe() ?? good.description,
    };
  }

  function grantViewOf(row: { id: number; goodId: number; periods: number; grantedAt: Date; expiresAt: Date | null; appliedAt: Date | null }, good: { name: string; kind: string }): GrantView {
    return {
      purchaseId: row.id,
      goodId: row.goodId,
      goodName: good.name,
      kind: good.kind,
      periods: row.periods,
      grantedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      applied: row.appliedAt !== null,
    };
  }

  async function activeGrants(userId: string): Promise<GrantView[]> {
    const rows = await db.purchase.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { good: { select: { name: true, kind: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => grantViewOf(r, r.good));
  }

  /** The same gate before money and before a hand-out (024 §1): a good that cannot be applied is refused. */
  async function precheckOrRefuse(good: GoodRecord, bound: BoundKind, userId: string, how: 'buy' | 'grant' = 'buy'): Promise<void> {
    const problems = await bound.precheck(env);
    if (problems.length === 0) return;
    await logging.failure(
      'shop.precheck_failed',
      { goodId: good.id, userId, how, problems: problems.map((p) => p.code) },
      `⚠️ ${
        how === 'buy' ? `${mention(userId)} не смог купить «${good.name}»` : `«${good.name}» не удалось выдать ${mention(userId)}`
      }: ${problemsText(problems)}. KP Coin не списаны. Настройка: /игры → ⚙️ Настройки → 🛒 Магазин.`,
    );
    throw new DomainError('SHOP_UNAVAILABLE', `good ${good.id}: ${problems.map((p) => p.code).join(',')}`);
  }

  /** The clan's name and colour, checked before any money moves (014 §3.2). */
  async function clanInput(bound: BoundKind, input: Pick<BuyInput, 'clan'>): Promise<{ name: string; color: number }> {
    const config = bound.config as ClanRoleConfig;
    if (!input.clan) throw new DomainError('STALE_PANEL', 'a new clan needs its name and colour');
    const colour = config.palette[input.clan.colorIndex];
    if (!colour) throw new DomainError('STALE_PANEL', `colour ${input.clan.colorIndex} not in the palette`);
    const name = normalizeName(input.clan.name);
    const problem = nameProblem(name, { forbiddenWords: config.forbiddenWords, roleNames: await gateway.guildRoleNames() });
    if (problem) throw new DomainError('NAME_INVALID', `clan name: ${problem}`, { reason: problem });
    return { name, color: colour.rgb };
  }

  /**
   * The rows a new grant is made of, inside the caller's transaction: the Purchase guarded by the
   * partial unique index on ACTIVE (user, good), then the clan or the room it owns. `pricePaid` is
   * the price for a purchase and 0 for an administrator's hand-out (024 §1); the money, when there
   * is any, is moved by the caller in the same transaction.
   */
  async function insertGrant(
    tx: Tx,
    args: { userId: string; good: GoodRecord; pricePaid: number; expiresAt: Date | null; clan: { name: string; color: number } | null; roomName: string | null; now: Date },
  ): Promise<number> {
    const { userId, good, now } = args;
    await tx.$executeRaw`INSERT INTO "User" ("id") VALUES (${userId}) ON CONFLICT ("id") DO NOTHING`;
    // Clan membership changes lock the User rows first (clan.ts): a member being added to a
    // clan cannot buy one at the same moment, and the reverse.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const inserted = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO "Purchase" ("userId", "goodId", "pricePaid", "status", "periods", "grantedAt", "expiresAt")
      VALUES (${userId}, ${good.id}, ${args.pricePaid}, 'ACTIVE', 1, ${now}, ${args.expiresAt})
      ON CONFLICT ("userId", "goodId") WHERE "status" = 'ACTIVE' DO NOTHING
      RETURNING "id"`;
    const purchaseId = inserted[0]?.id;
    if (purchaseId === undefined) throw new DomainError('ALREADY_OWNED', `user ${userId} good ${good.id}`);

    if (args.clan) {
      const member = await tx.$queryRaw<{ id: number }[]>`
        SELECT c."id" FROM "ClanMember" m JOIN "Clan" c ON c."id" = m."clanId"
        WHERE m."userId" = ${userId} AND c."closedAt" IS NULL LIMIT 1`;
      if (member[0]) throw new DomainError('IN_OTHER_CLAN', `user ${userId} is in clan ${member[0].id}`);
      const created = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO "Clan" ("purchaseId", "ownerId", "name", "color", "createdAt")
        VALUES (${purchaseId}, ${userId}, ${args.clan.name}, ${args.clan.color}, ${now})
        ON CONFLICT ((lower("name"))) WHERE "closedAt" IS NULL DO NOTHING
        RETURNING "id"`;
      if (!created[0]) throw new DomainError('NAME_TAKEN', `clan name ${args.clan.name}`);
    }
    if (args.roomName !== null) {
      await tx.personalRoom.create({ data: { purchaseId, ownerId: userId, name: args.roomName, createdAt: now } });
    }
    return purchaseId;
  }

  async function buyNew(userId: string, good: GoodRecord, bound: BoundKind, input: BuyInput) {
    const now = clock.now();
    const clan = good.kind === 'clan_role' ? await clanInput(bound, input) : null;
    const roomName = good.kind === 'personal_room' ? roomFirstName(input.roomName) : null;
    const expiresAt = good.validityDays === null ? null : new Date(now.getTime() + days(good.validityDays));
    return withTx(db, async (tx) => {
      const purchaseId = await insertGrant(tx, { userId, good, pricePaid: good.price, expiresAt, clan, roomName, now });
      const moved = await economy.move(
        {
          userId,
          amount: -good.price,
          kind: TxKind.PURCHASE,
          reference: `purchase:${purchaseId}:1`,
          description: `покупка: ${good.name}`,
          purchaseId,
        },
        tx,
      );
      return { purchaseId, periods: 1, expiresAt, balanceAfter: moved.entry.balanceAfter, clanName: clan?.name ?? null };
    });
  }

  async function buyRenewal(userId: string, good: GoodRecord, expected: number) {
    const now = clock.now();
    const validity = good.validityDays;
    if (validity === null) throw new DomainError('ALREADY_OWNED', `good ${good.id} is forever`);
    return withTx(db, async (tx) => {
      // 014 §1: a double click renews once; a renewal racing the expiry job either extends or
      // finds EXPIRED; an unapplied purchase cannot be renewed.
      const rows = await tx.$queryRaw<{ id: number; periods: number; expiresAt: Date }[]>`
        UPDATE "Purchase" SET
          "periods" = "periods" + 1,
          "pricePaid" = "pricePaid" + ${good.price},
          "expiresAt" = GREATEST("expiresAt", ${now}) + make_interval(days => ${validity}::int),
          "warnedAt" = NULL
        WHERE "userId" = ${userId} AND "goodId" = ${good.id} AND "status" = 'ACTIVE'
          AND "periods" = ${expected} AND "appliedAt" IS NOT NULL AND "expiresAt" IS NOT NULL
        RETURNING "id", "periods", "expiresAt"`;
      const row = rows[0];
      if (!row) throw new DomainError('STALE_PANEL', `renewal of good ${good.id} by ${userId}, expected period ${expected}`);
      const moved = await economy.move(
        {
          userId,
          amount: -good.price,
          kind: TxKind.PURCHASE,
          reference: `purchase:${row.id}:${row.periods}`,
          description: `продление: ${good.name}`,
          purchaseId: row.id,
        },
        tx,
      );
      return { purchaseId: row.id, periods: row.periods, expiresAt: row.expiresAt, balanceAfter: moved.entry.balanceAfter };
    });
  }

  /**
   * A hand-out (decision 024 §1): one transaction, and `economy` is never called — the ledger says
   * nothing, so `sum(ledger) = balance` cannot move. A player who has the good gets the days added
   * by the same guarded UPDATE the renewal uses (`periods = $expected`, read in the same
   * transaction because no panel carries the guard); a player who has not gets the same insert a
   * purchase makes, with `pricePaid` 0. Two invocations at once therefore add the days once: the
   * loser finds neither its row to update nor a free seat to insert into.
   */
  async function grantPeriod(userId: string, good: GoodRecord, bound: BoundKind, input: GrantByAdminInput, forDays: number) {
    const now = clock.now();
    const current = await db.purchase.findFirst({ where: { userId, goodId: good.id, status: 'ACTIVE' }, select: { id: true, expiresAt: true } });
    if (current) {
      // A good that never ends has nothing to extend; the same refusal a renewal gives (014 §1).
      if (current.expiresAt === null) throw new DomainError('ALREADY_OWNED', `good ${good.id} is forever`);
      return withTx(db, async (tx) => {
        const seen = await tx.$queryRaw<{ periods: number }[]>`
          SELECT "periods" FROM "Purchase" WHERE "id" = ${current.id} AND "status" = 'ACTIVE' AND "expiresAt" IS NOT NULL`;
        const expected = seen[0]?.periods;
        if (expected === undefined) throw new DomainError('GRANT_RACED', `purchase ${current.id} is no longer extendable`);
        const rows = await tx.$queryRaw<{ id: number; periods: number; expiresAt: Date }[]>`
          UPDATE "Purchase" SET
            "periods" = "periods" + 1,
            "expiresAt" = GREATEST("expiresAt", ${now}) + make_interval(days => ${forDays}::int),
            "warnedAt" = NULL
          WHERE "id" = ${current.id} AND "status" = 'ACTIVE' AND "periods" = ${expected} AND "expiresAt" IS NOT NULL
          RETURNING "id", "periods", "expiresAt"`;
        const row = rows[0];
        if (!row) throw new DomainError('GRANT_RACED', `grant of good ${good.id} to ${userId}`);
        return { purchaseId: row.id, periods: row.periods, expiresAt: row.expiresAt, extended: true, clanName: null as string | null };
      });
    }

    await precheckOrRefuse(good, bound, userId, 'grant');
    const clan = good.kind === 'clan_role' ? await clanInput(bound, input) : null;
    const roomName = good.kind === 'personal_room' ? roomFirstName(input.roomName) : null;
    const expiresAt = new Date(now.getTime() + days(forDays));
    return withTx(db, async (tx) => {
      const purchaseId = await insertGrant(tx, { userId, good, pricePaid: 0, expiresAt, clan, roomName, now }).catch((err: unknown) => {
        // The seat was taken between the read above and this insert: the other invocation granted.
        if (isDomainError(err) && err.code === 'ALREADY_OWNED') throw new DomainError('GRANT_RACED', `user ${userId} good ${good.id}`);
        throw err;
      });
      return { purchaseId, periods: 1, expiresAt, extended: false, clanName: clan?.name ?? null };
    });
  }

  /** One convergence pass of a (user, good) key (014 §2). */
  async function pass(userId: string, goodId: number): Promise<void> {
    const good = await loadGood(goodId);
    if (!good) return;
    const bound = bindKind(good);
    if (!bound) {
      await logging.failure('shop.good_unusable', { goodId }, `⚠️ Товар «${good.name}»: настройки испорчены — выдать или забрать его не получается. Проверь /игры → ⚙️ Настройки → 🛒 Магазин.`);
      return;
    }
    const rows = await db.purchase.findMany({
      where: { userId, goodId, OR: [{ status: 'ACTIVE' }, { cleanedAt: null }] },
      include: grantInclude,
      orderBy: { id: 'asc' },
    });
    const active = rows.find((r) => r.status === 'ACTIVE') ?? null;

    // 1. Take back every ended row. A shared resource stays while an ACTIVE row pays for it.
    for (const row of rows) {
      if (row.status === 'ACTIVE' || row.cleanedAt !== null) continue;
      try {
        if (!(bound.sharedResource && active)) await bound.revoke(stateOf(row), env);
      } catch (err) {
        if (!revokeFailuresReported.has(row.id)) {
          revokeFailuresReported.add(row.id);
          await logging.failure(
            'shop.revoke_failed',
            { purchaseId: row.id, userId, goodId, err },
            `⚠️ Не удалось забрать «${good.name}» у ${mention(userId)} (покупка #${row.id}): ${errorSummary(err)}. Пробую каждую минуту.`,
          );
        }
        throw err;
      }
      await db.purchase.updateMany({ where: { id: row.id, status: { not: 'ACTIVE' }, cleanedAt: null }, data: { cleanedAt: clock.now() } });
    }
    if (!active) return;

    // 2. Apply the ACTIVE row.
    try {
      const outcome = await bound.apply(stateOf(active), env);
      if (outcome === 'applied' && (active.appliedAt === null || active.lastApplyError !== null)) {
        await db.purchase.updateMany({ where: { id: active.id, status: 'ACTIVE' }, data: { appliedAt: active.appliedAt ?? clock.now(), lastApplyError: null } });
      }
    } catch (err) {
      await applyFailed(active, good, bound, err);
    }
  }

  async function applyFailed(row: PurchaseRow, good: GoodRecord, bound: BoundKind, err: unknown): Promise<void> {
    const summary = errorSummary(err);
    await db.purchase.updateMany({ where: { id: row.id, status: 'ACTIVE' }, data: { lastApplyError: summary.slice(0, 500) } });
    const now = clock.now();
    if (row.appliedAt === null && now.getTime() - row.grantedAt.getTime() >= refundAfterMs) {
      const present = await gateway.presentMembers([row.userId]);
      if (present.has(row.userId)) {
        await refund(row, good, bound, summary);
        return;
      }
    }
    if (row.lastApplyError === null) {
      await logging.failure(
        'shop.apply_failed',
        { purchaseId: row.id, userId: row.userId, goodId: good.id, err },
        `⚠️ Не удалось выдать «${good.name}» ${mention(row.userId)} (покупка #${row.id}): ${summary}. Пробую каждую минуту${row.appliedAt === null ? '; если за 30 минут не выйдет — KP Coin вернутся игроку' : ''}.`,
      );
    } else {
      await logging.failure('shop.apply_failed', { purchaseId: row.id, userId: row.userId, goodId: good.id, repeated: true, err });
    }
  }

  /** 014 §2: the grant never worked; the money goes back once, then the partial state is cleaned. */
  async function refund(row: PurchaseRow, good: GoodRecord, bound: BoundKind, why: string): Promise<void> {
    const now = clock.now();
    const amount = await withTxRetry(db, async (tx) => {
      const rows = await tx.$queryRaw<{ pricePaid: number }[]>`
        UPDATE "Purchase" SET "status" = 'REFUNDED', "revokedAt" = ${now}
        WHERE "id" = ${row.id} AND "status" = 'ACTIVE' AND "appliedAt" IS NULL
        RETURNING "pricePaid"`;
      const paid = rows[0]?.pricePaid;
      if (paid === undefined) return null;
      await closeClans(tx, [row.id], now);
      await economy.move(
        { userId: row.userId, amount: paid, kind: TxKind.REFUND, reference: `refund:${row.id}`, description: `возврат: ${good.name}`, purchaseId: row.id },
        tx,
      );
      return paid;
    });
    if (amount === null) return;
    await logging.event(
      'shop.refunded',
      { purchaseId: row.id, userId: row.userId, goodId: good.id, amount, why },
      `↩️ ${mention(row.userId)}: «${good.name}» не удалось выдать за 30 минут — ${amount} KP Coin возвращены (покупка #${row.id}). Причина: ${why}`,
    );
    try {
      // Re-read: this very pass may have created the clan role and saved its id (017 §1).
      const fresh = (await db.purchase.findUnique({ where: { id: row.id }, include: grantInclude })) ?? row;
      await bound.revoke(stateOf(fresh), env);
      await db.purchase.updateMany({ where: { id: row.id, cleanedAt: null }, data: { cleanedAt: clock.now() } });
    } catch (err) {
      await logging.failure('shop.refund_cleanup_failed', { purchaseId: row.id, err }); // the retry job cleans up
    }
    const sent = await gateway.sendDm(row.userId, { kind: 'grant_refunded', goodName: good.name, amount }).catch(() => 'refused' as const);
    await logging.event('shop.refund_notified', { purchaseId: row.id, userId: row.userId, sent });
  }

  function roomFirstName(raw: string | undefined): string {
    const name = normalizeName(raw ?? '');
    return nameProblem(name) === null ? name : '🏠 Личная комната';
  }

  async function requireSettings(actor: MemberFacts): Promise<void> {
    if (!(await permissions.can(actor, Capability.SETTINGS_MANAGE))) throw new DomainError('NOT_ALLOWED', 'shop settings');
  }

  /** The right, not the command's visibility, is what allows `/отозвать` and `/выдать-товар`
   * (decisions 020 §3, 023 §4, 024 §2). */
  async function requireShopManage(actor: MemberFacts, what: string): Promise<void> {
    if (!(await permissions.can(actor, Capability.SHOP_MANAGE))) throw new DomainError('NOT_ALLOWED', what);
  }

  async function adminView(good: GoodRecord, mode: 'precheck' | 'validate'): Promise<GoodAdminView> {
    const bound = bindKind(good);
    if (!bound) return { good, line: good.description, problems: [{ code: 'bad_config' }], warnings: [] };
    if (mode === 'precheck') return { good, line: bound.describe(), problems: await bound.precheck(env), warnings: [] };
    const result = await bound.validate(env);
    const fresh = (await loadGood(good.id)) ?? good; // validate may have stored a role id
    return { good: fresh, line: bound.describe(), problems: result.problems, warnings: result.warnings };
  }

  const service: ShopService = {
    async overview(userId) {
      const [{ balance }, goods, grants, clan, room] = await Promise.all([
        economy.ensureUser(userId),
        db.shopGood.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
        activeGrants(userId),
        db.clan.findFirst({ where: { closedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] }, select: { id: true } }),
        db.personalRoom.findFirst({ where: { ownerId: userId, purchase: { status: 'ACTIVE' } }, select: { id: true } }),
      ]);
      return {
        balance,
        goods: goods.map((row) => {
          const good = toGoodRecord(row);
          return { ...offerOf(good, bindKind(good)), grant: grants.find((g) => g.goodId === good.id) ?? null };
        }),
        grants,
        inClan: clan !== null,
        hasRoom: room !== null,
      };
    },

    grants: activeGrants,

    async quote(userId, goodId) {
      const good = await loadGood(goodId);
      if (!good) throw new DomainError('NOT_FOUND', `good ${goodId}`);
      if (!good.enabled) throw new DomainError('GOOD_DISABLED', `good ${goodId}`);
      const [{ balance }, current] = await Promise.all([
        economy.ensureUser(userId),
        db.purchase.findFirst({ where: { userId, goodId, status: 'ACTIVE' } }),
      ]);
      const now = clock.now();
      const bound = bindKind(good);
      const offer = offerOf(good, bound);
      const currentView = current ? grantViewOf(current, good) : null;
      const mode: QuoteMode = !current ? 'new' : current.appliedAt === null ? 'pending' : good.validityDays === null || current.expiresAt === null ? 'owned' : 'renew';
      const base = mode === 'renew' && current?.expiresAt && current.expiresAt > now ? current.expiresAt : now;
      return {
        good: offer,
        mode,
        price: good.price,
        balance,
        shortBy: Math.max(0, good.price - balance),
        expectedPeriods: mode === 'renew' ? (current?.periods ?? 0) : 0,
        expiresAt: good.validityDays === null ? null : new Date(base.getTime() + days(good.validityDays)),
        current: currentView,
        clanForm: mode === 'new' && good.kind === 'clan_role',
        palette: good.kind === 'clan_role' && bound ? (bound.config as ClanRoleConfig).palette : null,
      };
    },

    async buy(userId, goodId, expectedPeriods, input = {}) {
      if (isFakeUserId(userId)) throw new DomainError('INVALID_TARGET', 'fake buyer');
      const good = await loadGood(goodId);
      if (!good) throw new DomainError('NOT_FOUND', `good ${goodId}`);
      if (!good.enabled) throw new DomainError('GOOD_DISABLED', `good ${goodId}`);
      const bound = bindKind(good);
      if (!bound) throw new DomainError('SHOP_UNAVAILABLE', `good ${goodId}: unknown kind or bad config`);

      const renewed = expectedPeriods > 0;
      let done: { purchaseId: number; periods: number; expiresAt: Date | null; balanceAfter: number; clanName?: string | null };
      if (renewed) done = await buyRenewal(userId, good, expectedPeriods);
      else {
        await precheckOrRefuse(good, bound, userId);
        done = await buyNew(userId, good, bound, input);
      }

      const until = done.expiresAt ? ` до <t:${Math.floor(done.expiresAt.getTime() / 1000)}:D>` : ' навсегда';
      await logging.event(
        renewed ? 'shop.renewed' : 'shop.purchased',
        { purchaseId: done.purchaseId, userId, goodId, price: good.price, periods: done.periods, expiresAt: done.expiresAt },
        renewed
          ? `🔁 ${mention(userId)} продлил «${good.name}» (покупка #${done.purchaseId}, период ${done.periods}) за ${good.price} KP Coin —${until}.`
          : `🛒 ${mention(userId)} купил «${good.name}» за ${good.price} KP Coin (покупка #${done.purchaseId})${until}.${done.clanName ? ` Клан «${done.clanName}».` : ''}`,
      );

      // 014 §2: wait for our own pass for a while; after that the player hears «в течение пары минут».
      await Promise.race([queue.enqueue(keyOf(userId, goodId)), sleep(applyWaitMs, undefined, { ref: false })]);
      const after = await db.purchase.findUnique({ where: { id: done.purchaseId }, select: { appliedAt: true } });
      return {
        purchaseId: done.purchaseId,
        goodName: good.name,
        kind: good.kind,
        periods: done.periods,
        renewed,
        expiresAt: done.expiresAt,
        applied: after?.appliedAt != null,
        balanceAfter: done.balanceAfter,
      };
    },

    reconcile: (userId, goodId) => queue.enqueue(keyOf(userId, goodId)),

    async reconcileAll() {
      const keys = await db.$queryRaw<{ userId: string; goodId: number }[]>`
        SELECT DISTINCT "userId", "goodId" FROM "Purchase"
        WHERE "status" = 'ACTIVE' OR "cleanedAt" IS NULL
        ORDER BY "userId", "goodId"`;
      await Promise.all(keys.map((k) => queue.enqueue(keyOf(k.userId, k.goodId))));
      return keys.length;
    },

    async expirePass(now) {
      const expired = await withTxRetry(db, async (tx) => {
        const rows = await tx.$queryRaw<{ id: number; userId: string; goodId: number }[]>`
          UPDATE "Purchase" SET "status" = 'EXPIRED'
          WHERE "status" = 'ACTIVE' AND "expiresAt" <= ${now}
          RETURNING "id", "userId", "goodId"`;
        await closeClans(
          tx,
          rows.map((r) => r.id),
          now,
        );
        return rows;
      });
      if (expired.length === 0) return [];
      const names = new Map((await db.shopGood.findMany({ select: { id: true, name: true } })).map((g) => [g.id, g.name]));
      for (const r of expired) {
        await logging.event(
          'shop.expired',
          { purchaseId: r.id, userId: r.userId, goodId: r.goodId },
          `⌛ У ${mention(r.userId)} закончилось «${names.get(r.goodId) ?? `товар #${r.goodId}`}» (покупка #${r.id}).`,
        );
      }
      await Promise.all(expired.map((r) => queue.enqueue(keyOf(r.userId, r.goodId))));
      return expired.map((r) => r.id);
    },

    async warnPass(now) {
      // Claim first (014 §4.1): a crash may lose a warning, but none is ever sent twice.
      const soon = new Date(now.getTime() + WARN_BEFORE_MS);
      const claimed = await db.$queryRaw<{ id: number; userId: string; expiresAt: Date; name: string }[]>`
        UPDATE "Purchase" p SET "warnedAt" = ${now}
        FROM "ShopGood" g
        WHERE g."id" = p."goodId" AND p."status" = 'ACTIVE' AND p."warnedAt" IS NULL
          AND p."expiresAt" IS NOT NULL AND p."expiresAt" <= ${soon}
        RETURNING p."id", p."userId", p."expiresAt", g."name"`;
      for (const c of claimed) {
        const sent = await gateway.sendDm(c.userId, { kind: 'grant_expiring', goodName: c.name, expiresAt: c.expiresAt }).catch(() => 'refused' as const);
        await logging.event('shop.warned', { purchaseId: c.id, userId: c.userId, sent });
      }
      return claimed.map((c) => c.id);
    },

    async retryPass() {
      const rows = await db.purchase.findMany({
        where: { OR: [{ status: 'ACTIVE', appliedAt: null }, { status: { not: 'ACTIVE' }, cleanedAt: null }] },
        select: { userId: true, goodId: true, status: true },
      });
      // Absent buyers wait for guildMemberAdd; cleanups do not depend on the buyer.
      const pendingUsers = [...new Set(rows.filter((r) => r.status === 'ACTIVE').map((r) => r.userId))];
      const present = pendingUsers.length > 0 ? await gateway.presentMembers(pendingUsers) : new Set<string>();
      const keys = [...new Set(rows.filter((r) => r.status !== 'ACTIVE' || present.has(r.userId)).map((r) => keyOf(r.userId, r.goodId)))];
      await Promise.all(keys.map((k) => queue.enqueue(k)));
      return keys.length;
    },

    async memberJoined(userId) {
      const rows = await db.purchase.findMany({ where: { userId, status: 'ACTIVE' }, select: { goodId: true } });
      await Promise.all(rows.map((r) => queue.enqueue(keyOf(userId, r.goodId))));
    },

    async memberLeft(userId) {
      // 014 §3.4: a member or guest who leaves frees the seat; an owner keeps the clan or room.
      const freed = await withTxRetry(db, async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        // Clan before its members (017 §3). With the User row locked nobody can add the player to
        // another clan meanwhile; expiry may still empty this one, so the DELETE may find nothing.
        const member = await tx.$queryRaw<{ clanId: number }[]>`SELECT "clanId" FROM "ClanMember" WHERE "userId" = ${userId}`;
        const clans: { clanId: number }[] = [];
        for (const { clanId } of member) {
          await tx.$queryRaw`SELECT "id" FROM "Clan" WHERE "id" = ${clanId} FOR UPDATE`;
          const deleted = await tx.$queryRaw<{ clanId: number }[]>`
            DELETE FROM "ClanMember" WHERE "userId" = ${userId} AND "clanId" = ${clanId} RETURNING "clanId"`;
          if (!deleted[0]) continue;
          await tx.$executeRaw`UPDATE "Clan" SET "memberCount" = "memberCount" - 1 WHERE "id" = ${clanId} AND "memberCount" > 0`;
          clans.push(deleted[0]);
        }
        const rooms = await tx.$queryRaw<{ roomId: number }[]>`DELETE FROM "RoomGuest" WHERE "userId" = ${userId} RETURNING "roomId"`;
        for (const { roomId } of rooms) {
          await tx.$executeRaw`UPDATE "PersonalRoom" SET "guestCount" = "guestCount" - 1 WHERE "id" = ${roomId} AND "guestCount" > 0`;
        }
        return { clanIds: clans.map((c) => c.clanId), roomIds: rooms.map((r) => r.roomId) };
      });
      const owners = await db.purchase.findMany({
        where: { OR: [{ clan: { id: { in: freed.clanIds } } }, { room: { id: { in: freed.roomIds } } }] },
        select: { userId: true, goodId: true, clan: { select: { name: true } }, room: { select: { name: true } } },
      });
      for (const o of owners) {
        const what = o.clan ? `место в клане «${o.clan.name}»` : `место гостя в комнате «${o.room?.name ?? ''}»`;
        await logging.event('shop.member_left', { userId, ownerId: o.userId }, `🚪 ${mention(userId)} покинул сервер — ${what} освободилось.`);
        void queue.enqueue(keyOf(o.userId, o.goodId));
      }
    },

    async adminList(actor) {
      await requireSettings(actor);
      const goods = await db.shopGood.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
      return Promise.all(goods.map((g) => adminView(toGoodRecord(g), 'precheck')));
    },

    async goodBySlug(slug) {
      const row = await db.shopGood.findUnique({ where: { slug } });
      return row ? toGoodRecord(row) : null;
    },

    async grantByAdmin(actor, input) {
      await requireShopManage(actor, 'grant good');
      if (input.targetIsBot) throw new DomainError('TARGET_IS_BOT', input.userId);
      if (isFakeUserId(input.userId)) throw new DomainError('INVALID_TARGET', 'fake player');
      if (!Number.isSafeInteger(input.days) || input.days < GRANT_DAYS_MIN || input.days > GRANT_DAYS_MAX) {
        throw new DomainError('DAYS_INVALID', `days ${input.days}`);
      }
      const good = await loadGood(input.goodId);
      if (!good) throw new DomainError('NOT_FOUND', `good ${input.goodId}`);
      // A good the owner switched off is not handed out either (024 §1): the administrator is told
      // which one and where the switch is, and nothing is written.
      if (!good.enabled) throw new DomainError('GOOD_DISABLED', `good ${input.goodId}`, { goodName: good.name });
      const bound = bindKind(good);
      if (!bound) throw new DomainError('SHOP_UNAVAILABLE', `good ${input.goodId}: unknown kind or bad config`);

      const done = await grantPeriod(input.userId, good, bound, input, input.days);

      // The audit line first, before Discord and before the player is told: a failure below must
      // never lose the record of what an administrator gave away (the ordering of 021 and 023).
      await logging.event(
        'shop.granted',
        { purchaseId: done.purchaseId, actorId: actor.userId, userId: input.userId, goodId: good.id, days: input.days, periods: done.periods, extended: done.extended },
        `🎁 ${mention(actor.userId)} ${done.extended ? 'продлил' : 'выдал'} «${good.name}» ${mention(input.userId)} на ${input.days} дн. — до <t:${Math.floor(
          done.expiresAt.getTime() / 1000,
        )}:D> (покупка #${done.purchaseId}). KP Coin не списаны.${done.clanName ? ` Клан «${done.clanName}».` : ''}`,
      );

      // Discord follows through the same convergence a purchase uses (024 §1).
      await Promise.race([queue.enqueue(keyOf(input.userId, good.id)), sleep(applyWaitMs, undefined, { ref: false })]);
      const after = await db.purchase.findUnique({ where: { id: done.purchaseId }, select: { appliedAt: true } });

      const sent = await gateway
        .sendDm(input.userId, { kind: 'grant_gifted', goodName: good.name, expiresAt: done.expiresAt, extended: done.extended })
        .catch(() => 'refused' as const);
      await logging.event('shop.grant_notified', { purchaseId: done.purchaseId, userId: input.userId, sent });

      return {
        purchaseId: done.purchaseId,
        userId: input.userId,
        goodName: good.name,
        kind: good.kind,
        days: input.days,
        periods: done.periods,
        extended: done.extended,
        expiresAt: done.expiresAt,
        applied: after?.appliedAt != null,
        notified: sent !== 'refused',
      };
    },

    async revokeList(actor, userId) {
      await requireShopManage(actor, 'revoke list');
      const rows = await db.purchase.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { good: { select: { name: true, kind: true } } },
        orderBy: { id: 'asc' },
      });
      return rows.map((r) => ({
        purchaseId: r.id,
        goodId: r.goodId,
        goodName: r.good.name,
        kind: r.good.kind,
        periods: r.periods,
        pricePaid: r.pricePaid,
        expiresAt: r.expiresAt,
        applied: r.appliedAt !== null,
      }));
    },

    async revoke(actor, { purchaseId, expectedPeriods, refund }) {
      await requireShopManage(actor, 'revoke purchase');
      // Read for the texts only; what decides is the guarded UPDATE below.
      const before = await db.purchase.findUnique({ where: { id: purchaseId }, include: { good: { select: { name: true, kind: true } } } });
      if (!before) throw new DomainError('NOT_FOUND', `purchase ${purchaseId}`);
      const goodName = before.good.name;
      const now = clock.now();

      const done = await withTxRetry(db, async (tx) => {
        // The whole safety of the command is this guard (023 §3): a purchase that was renewed,
        // expired, refunded or already revoked since the panel was drawn finds no row, so nothing
        // is taken back twice and `refund:<id>` — the reference the failed-apply refund also uses
        // (014 §2) — is claimed at most once per purchase.
        const rows = await tx.$queryRaw<{ userId: string; goodId: number; pricePaid: number }[]>`
          UPDATE "Purchase" SET "status" = 'REVOKED', "revokedAt" = ${now}, "revokedById" = ${actor.userId}
          WHERE "id" = ${purchaseId} AND "status" = 'ACTIVE' AND "periods" = ${expectedPeriods}
          RETURNING "userId", "goodId", "pricePaid"`;
        const row = rows[0];
        if (!row) return null;
        // A clan closes exactly as expiry closes it: members freed, name free again (023 §2).
        await closeClans(tx, [purchaseId], now);
        if (!refund || row.pricePaid <= 0) return { ...row, refunded: refund ? 0 : null, balanceAfter: null };
        const moved = await economy.move(
          { userId: row.userId, amount: row.pricePaid, kind: TxKind.REFUND, reference: `refund:${purchaseId}`, description: `возврат: ${goodName}`, purchaseId, actorId: actor.userId },
          tx,
        );
        return { ...row, refunded: row.pricePaid, balanceAfter: moved.entry.balanceAfter };
      });
      if (!done) throw new DomainError('STALE_PANEL', `revoke of purchase ${purchaseId}, expected period ${expectedPeriods}`);

      // The audit line first: the money has committed, and a Discord failure below must never
      // lose it (the ordering fix of the /начислить review, 2026-09-20).
      await logging.event(
        'shop.revoked',
        { purchaseId, actorId: actor.userId, userId: done.userId, goodId: done.goodId, refunded: done.refunded },
        `🚫 ${mention(actor.userId)} отозвал «${goodName}» у ${mention(done.userId)} (покупка #${purchaseId}) — ${
          done.refunded === null ? 'без возврата KP Coin' : `${done.refunded} KP Coin возвращены`
        }.`,
      );

      // Discord follows through the same convergence as expiry: the role is taken away, the clan
      // role deleted, the room deleted — never a separate path (023 §2).
      await Promise.race([queue.enqueue(keyOf(done.userId, done.goodId)), sleep(applyWaitMs, undefined, { ref: false })]);
      const after = await db.purchase.findUnique({ where: { id: purchaseId }, select: { cleanedAt: true } });

      const sent = await gateway.sendDm(done.userId, { kind: 'grant_revoked', goodName, amount: done.refunded }).catch(() => 'refused' as const);
      await logging.event('shop.revoke_notified', { purchaseId, userId: done.userId, sent });

      return {
        purchaseId,
        userId: done.userId,
        goodName,
        kind: before.good.kind,
        refunded: done.refunded,
        balanceAfter: done.balanceAfter,
        cleaned: after?.cleanedAt != null,
        notified: sent !== 'refused',
      };
    },

    async configure(actor, goodId, patch) {
      await requireSettings(actor);
      const good = await loadGood(goodId);
      if (!good) throw new DomainError('NOT_FOUND', `good ${goodId}`);
      const bound = bindKind(good);
      if (!bound) throw new DomainError('SHOP_UNAVAILABLE', `good ${goodId}: bad config`);
      const next = bound.withPatch(patch);
      if (!next) throw new DomainError('STALE_PANEL', `good ${goodId}: patch refused`);

      // A channel taken off the list goes back to the server's own rules (014 §3.1).
      if (good.kind === 'channel_permission') {
        const before = new Set((bound.config.channelIds as string[] | undefined) ?? []);
        const after = new Set((next.channelIds as string[] | undefined) ?? []);
        const permissionsList = (bound.config.permissions as ('AttachFiles' | 'EmbedLinks')[] | undefined) ?? [];
        for (const channelId of before) {
          if (after.has(channelId)) continue;
          await gateway.clearAccessOverwrite(channelId, (bound.config.roleId as string | null | undefined) ?? null, permissionsList).catch((err: unknown) =>
            logging.failure('shop.clear_overwrite_failed', { goodId, channelId, err }),
          );
        }
      }
      const changed = Object.fromEntries(Object.entries(patch).filter(([k]) => bound.settable.includes(k)));
      await env.saveGoodConfig(goodId, changed);
      const view = await adminView((await loadGood(goodId)) ?? good, 'validate');
      await logging.event(
        'shop.configured',
        { goodId, patch: changed, actorId: actor.userId, problems: view.problems.map((p) => p.code) },
        `⚙️ ${mention(actor.userId)} изменил настройки товара «${good.name}».${view.problems.length > 0 ? ` Осталось поправить: ${problemsText(view.problems)}.` : ''}`,
      );
      return view;
    },

    async setEnabled(actor, goodId, enabled) {
      await requireSettings(actor);
      const good = await loadGood(goodId);
      if (!good) throw new DomainError('NOT_FOUND', `good ${goodId}`);
      if (!enabled) {
        await db.shopGood.update({ where: { id: goodId }, data: { enabled: false } });
        await logging.event('shop.disabled', { goodId, actorId: actor.userId }, `⛔ ${mention(actor.userId)} выключил товар «${good.name}». Купленное доработает свой срок.`);
        return { ...(await adminView({ ...good, enabled: false }, 'precheck')), enabled: false };
      }
      const view = await adminView(good, 'validate');
      if (view.problems.length > 0) return { ...view, enabled: good.enabled };
      await db.shopGood.update({ where: { id: goodId }, data: { enabled: true } });
      await logging.event('shop.enabled', { goodId, actorId: actor.userId }, `✅ ${mention(actor.userId)} включил товар «${good.name}» (${good.price} KP Coin).`);
      return { ...view, good: { ...view.good, enabled: true }, enabled: true };
    },

    async startup() {
      const goods = await db.shopGood.findMany({ where: { enabled: true }, orderBy: { id: 'asc' } });
      for (const row of goods) {
        const good = toGoodRecord(row);
        const bound = bindKind(good);
        if (!bound) {
          await db.shopGood.update({ where: { id: good.id }, data: { enabled: false } });
          await logging.failure('shop.good_disabled_at_start', { goodId: good.id, kind: good.kind }, `⛔ Товар «${good.name}» выключен при запуске: его вид или настройки не распознаны.`);
          continue;
        }
        try {
          const { problems } = await bound.validate(env);
          if (problems.length > 0) {
            await logging.failure('shop.validate_problems', { goodId: good.id, problems: problems.map((p) => p.code) }, `⚠️ Товар «${good.name}»: ${problemsText(problems)}. Покупки не пройдут, пока это не исправлено.`);
          }
        } catch (err) {
          await logging.failure('shop.validate_failed', { goodId: good.id, err }, `⚠️ Товар «${good.name}»: проверка при запуске не удалась — ${errorSummary(err)}.`);
        }
      }
      const keys = await service.reconcileAll();
      await logging.event('shop.startup', { enabledGoods: goods.length, reconciledKeys: keys });
    },

    async devExpireSoon(actor, purchaseId) {
      if (!mayUseDevTools(actor, deps.nodeEnv)) throw new DomainError('NOT_ALLOWED', 'dev expire');
      const at = new Date(clock.now().getTime() + DEV_EXPIRE_IN_MS);
      const rows = await db.$queryRaw<{ id: number; goodId: number }[]>`
        UPDATE "Purchase" SET "expiresAt" = ${at}, "warnedAt" = NULL
        WHERE "id" = ${purchaseId} AND "userId" = ${actor.userId} AND "status" = 'ACTIVE' AND "expiresAt" IS NOT NULL
        RETURNING "id", "goodId"`;
      if (!rows[0]) throw new DomainError('STALE_PANEL', `purchase ${purchaseId}`);
      await logging.event('shop.dev_expire', { purchaseId, actorId: actor.userId }, `🧪 ${mention(actor.userId)}: покупка #${purchaseId} закончится через 2 минуты (тест).`);
      return at;
    },

    idle: () => queue.idle(),
  };
  return service;
}
