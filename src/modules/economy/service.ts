// KP Coin. `move` is the ONLY writer of balances (decision 003 §4): a ledger row with a unique
// reference, then a conditional balance update, inside the caller's transaction.
import { DomainError } from '../../core/errors.js';
import type { Db, Tx } from '../../db/client.js';
import { withTx } from '../../db/tx.js';
import { TxKind } from '../../generated/prisma/enums.js';

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

export interface EconomyService {
  /** Creates the user row on first contact; returns the balance. */
  ensureUser(userId: string): Promise<{ balance: number }>;
  /** Applies a KP movement at most once. Pass `tx` to join the caller's transaction. */
  move(input: MoveInput, tx?: Tx): Promise<MoveResult>;
  /** Newest first. */
  history(userId: string, limit: number): Promise<LedgerEntry[]>;
}

export function createEconomyService(db: Db): EconomyService {
  return {
    async ensureUser(userId) {
      const user = await db.user.upsert({ where: { id: userId }, create: { id: userId }, update: {}, select: { balance: true } });
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
  };
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
