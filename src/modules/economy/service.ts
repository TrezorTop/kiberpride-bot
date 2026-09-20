// KP Coin. `move` is the ONLY writer of balances (decision 003 §4): a ledger row with a unique
// reference, then a conditional balance update, inside the caller's transaction.
import { DomainError, isDomainError } from '../../core/errors.js';
import type { Db, Tx } from '../../db/client.js';
import { withTx } from '../../db/tx.js';
import { TxKind } from '../../generated/prisma/enums.js';
import { mayUseDevTools } from '../permissions/devTools.js';
import { Capability, createPermissionsService, dbPermissionSources, type MemberFacts, type PermissionsService } from '../permissions/service.js';

export { TxKind };

export interface MoveInput {
  userId: string;
  /** Signed, non-zero, whole KP. */
  amount: number;
  kind: TxKind;
  /** One economic fact = one reference (003 §3), e.g. `match:12:win:<userId>`. */
  reference: string;
  description: string;
  matchId?: number;
  purchaseId?: number;
  actorId?: string;
}

export interface LedgerEntry {
  id: number;
  userId: string;
  amount: number;
  balanceAfter: number;
  kind: TxKind;
  reference: string;
  description: string;
  createdAt: Date;
}

export interface MoveResult {
  entry: LedgerEntry;
  /** false = the reference was already applied; nothing moved this time. */
  applied: boolean;
}

export interface HistoryPage {
  entries: LedgerEntry[];
  /** 1-based, clamped into 1..pages. */
  page: number;
  /** At least 1, so an empty history is one empty page. */
  pages: number;
  total: number;
}

/** «🧪 +10 000 KP Coin» (decision 014 §12). */
export const DEV_TOP_UP_AMOUNT = 10_000;

/** The most one `/начислить` may move, in either direction (decision 021 §1). */
export const ADMIN_ADJUST_MAX = 1_000_000;

/** «за что» is free text; Discord truncates at this length, the service again. */
export const ADMIN_ADJUST_REASON_MAX = 100;

/** The history line when the administrator gave no reason (decision 021 §1). */
export const ADMIN_ADJUST_DEFAULT_REASON = 'начислено администратором';

/** Minted per invocation; `admin:<nonce>` is the reference (decision 003 §3). */
const NONCE = /^[A-Za-z0-9_-]{6,32}$/;

/**
 * What the player's history shows: «+500 KP Coin — приз за турнир», or the default line when the
 * administrator gave no reason. Collapsed to one line — a ledger line is rendered inline.
 */
export function adminAdjustDescription(reason: string | null | undefined): string {
  const text = (reason ?? '').replace(/\s+/g, ' ').trim().slice(0, ADMIN_ADJUST_REASON_MAX);
  return text.length > 0 ? text : ADMIN_ADJUST_DEFAULT_REASON;
}

export interface AdminAdjustInput {
  /** The player whose balance moves. */
  userId: string;
  /** Signed, non-zero, at most ADMIN_ADJUST_MAX either way. */
  amount: number;
  /** «за что», shown to the player in their history; empty falls back to the default line. */
  reason?: string | null;
  /** One invocation, one reference: a redelivered interaction pays once (decision 021 §4). */
  nonce: string;
  /** Only Discord knows this; a bot has no balance to move. */
  targetIsBot?: boolean;
}

export interface EconomyService {
  /** Creates the user row on first contact; returns the balance. */
  ensureUser(userId: string): Promise<{ balance: number }>;
  /** Applies a KP movement at most once. Pass `tx` to join the caller's transaction. */
  move(input: MoveInput, tx?: Tx): Promise<MoveResult>;
  /** Newest first. */
  history(userId: string, limit: number): Promise<LedgerEntry[]>;
  /** «Вся история», newest first, `size` lines a page (decision 014 §10). */
  historyPage(userId: string, page: number, size?: number): Promise<HistoryPage>;
  /**
   * +10 000 KP with reference `dev:<nonce>`: the nonce is minted when /профиль renders, so a
   * double press pays once. Test server and guild owner only, checked here as well (014 §12).
   */
  devTopUp(actor: MemberFacts, nonce: string, nodeEnv: string): Promise<MoveResult>;
  /**
   * `/начислить` (decision 021): an administrator moves KP Coin by hand, either way. Needs
   * ECONOMY_ADMIN — the command's visibility is not the guard (decision 020 §3). Paying oneself
   * is allowed and logged; a balance never goes below zero.
   */
  adminAdjust(actor: MemberFacts, input: AdminAdjustInput): Promise<MoveResult>;
}

export const HISTORY_PAGE_SIZE = 10;

export interface EconomyDeps {
  /**
   * Who may move KP Coin by hand. Left out, the service builds one over the same `db`: the rights
   * are data, so a second instance answers identically, and tests need not wire one. Only
   * `setRoles` needs the @everyone id, and economy never calls it.
   */
  permissions?: PermissionsService;
}

export function createEconomyService(db: Db, deps: EconomyDeps = {}): EconomyService {
  const permissions = deps.permissions ?? createPermissionsService(dbPermissionSources(db));
  const service: EconomyService = {
    async ensureUser(userId) {
      // ON CONFLICT DO NOTHING, not `upsert`: an empty `update` makes Prisma read-then-insert, so
      // two first contacts at once collide on the primary key. Found by the concurrency test of
      // decision 021; the same raw insert `move` has always used (003 §4).
      await db.$executeRaw`INSERT INTO "User" ("id") VALUES (${userId}) ON CONFLICT ("id") DO NOTHING`;
      const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
      return { balance: user.balance };
    },

    move(input, tx) {
      return tx ? move(tx, input) : withTx(db, (t) => move(t, input));
    },

    async history(userId, limit) {
      return db.kpTransaction.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: ledgerSelect,
      });
    },

    async historyPage(userId, page, size = HISTORY_PAGE_SIZE) {
      const total = await db.kpTransaction.count({ where: { userId } });
      const pages = Math.max(1, Math.ceil(total / size));
      const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
      const entries = await db.kpTransaction.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * size,
        take: size,
        select: ledgerSelect,
      });
      return { entries, page: current, pages, total };
    },

    async devTopUp(actor, nonce, nodeEnv) {
      if (!mayUseDevTools(actor, nodeEnv)) throw new DomainError('NOT_ALLOWED', 'dev top-up');
      if (!NONCE.test(nonce)) throw new DomainError('STALE_PANEL', `bad nonce ${nonce}`);
      return service.move({
        userId: actor.userId,
        amount: DEV_TOP_UP_AMOUNT,
        kind: TxKind.ADMIN_ADJUST,
        reference: `dev:${nonce}`,
        description: '🧪 тестовое пополнение',
        actorId: actor.userId,
      });
    },

    async adminAdjust(actor, input) {
      // The right, not the command's visibility, is what allows this (decisions 020 §3, 021 §2).
      if (!(await permissions.can(actor, Capability.ECONOMY_ADMIN))) throw new DomainError('NOT_ALLOWED', 'admin adjust');
      if (input.targetIsBot) throw new DomainError('TARGET_IS_BOT', input.userId);
      if (!Number.isSafeInteger(input.amount) || input.amount === 0 || Math.abs(input.amount) > ADMIN_ADJUST_MAX) {
        throw new DomainError('AMOUNT_INVALID', `amount ${input.amount}`);
      }
      if (!NONCE.test(input.nonce)) throw new DomainError('STALE_PANEL', `bad nonce ${input.nonce}`);
      // An administrator may pay themselves: deliberate, and the log channel names them (021 §3).

      const { balance } = await service.ensureUser(input.userId);
      // Refusing here is what lets the message say how much the player actually has; the balance
      // is really kept non-negative by the conditional update in `move` (003 §4), which refuses
      // again under the row lock if the balance moved in between — see the catch below.
      if (balance + input.amount < 0) throw new DomainError('BALANCE_TOO_LOW', `user ${input.userId}, amount ${input.amount}`, { balance });

      try {
        return await service.move({
          userId: input.userId,
          amount: input.amount,
          kind: TxKind.ADMIN_ADJUST,
          reference: `admin:${input.nonce}`,
          description: adminAdjustDescription(input.reason),
          actorId: actor.userId,
        });
      } catch (err) {
        if (!isDomainError(err) || err.code !== 'INSUFFICIENT_FUNDS') throw err;
        const now = await service.ensureUser(input.userId);
        throw new DomainError('BALANCE_TOO_LOW', `user ${input.userId}, amount ${input.amount}`, { balance: now.balance });
      }
    },
  };
  return service;
}

const ledgerSelect = {
  id: true,
  userId: true,
  amount: true,
  balanceAfter: true,
  kind: true,
  reference: true,
  description: true,
  createdAt: true,
} as const;

/**
 * 003 §4, step by step. A second transaction with the same reference blocks on the unique index
 * in step 1 until the first finishes, then becomes a no-op (or proceeds if the first rolled back).
 */
async function move(tx: Tx, input: MoveInput): Promise<MoveResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
    throw new Error(`economy.move: amount must be a non-zero integer, got ${input.amount}`);
  }

  // The ledger row references the user, so the user must exist (first contact may be a reward).
  await tx.$executeRaw`INSERT INTO "User" ("id") VALUES (${input.userId}) ON CONFLICT ("id") DO NOTHING`;

  // 1. Claim the reference. balanceAfter is written in step 3 once the new balance is known.
  const inserted = await tx.$queryRaw<{ id: number }[]>`
    INSERT INTO "KpTransaction"
      ("userId", "amount", "balanceAfter", "kind", "reference", "description", "matchId", "purchaseId", "actorId")
    VALUES
      (${input.userId}, ${input.amount}, 0, ${input.kind}::"TxKind", ${input.reference}, ${input.description},
       ${input.matchId ?? null}, ${input.purchaseId ?? null}, ${input.actorId ?? null})
    ON CONFLICT ("reference") DO NOTHING
    RETURNING "id"`;

  const claimed = inserted[0];
  if (!claimed) {
    const existing = await tx.kpTransaction.findUniqueOrThrow({ where: { reference: input.reference }, select: ledgerSelect });
    // Same reference, different fact = a bug in the caller's reference scheme; a silent no-op
    // would hide an unpaid reward. A plain Error, not a DomainError: no player can fix it.
    if (existing.userId !== input.userId || existing.amount !== input.amount || existing.kind !== input.kind) {
      throw new Error(
        `economy.move: reference ${input.reference} already applied as ` +
          `{userId ${existing.userId}, amount ${existing.amount}, kind ${existing.kind}}, ` +
          `got {userId ${input.userId}, amount ${input.amount}, kind ${input.kind}}`,
      );
    }
    return { entry: existing, applied: false };
  }

  // 2. Move the balance only if it stays non-negative; no row back = not enough KP.
  const updated = await tx.$queryRaw<{ balance: number }[]>`
    UPDATE "User" SET "balance" = "balance" + ${input.amount}, "updatedAt" = now()
    WHERE "id" = ${input.userId} AND "balance" + ${input.amount} >= 0
    RETURNING "balance"`;
  const after = updated[0];
  if (!after) throw new DomainError('INSUFFICIENT_FUNDS', `user ${input.userId}, amount ${input.amount}`);

  // 3. Record the balance this movement produced.
  const entry = await tx.kpTransaction.update({
    where: { id: claimed.id },
    data: { balanceAfter: after.balance },
    select: ledgerSelect,
  });
  return { entry, applied: true };
}
