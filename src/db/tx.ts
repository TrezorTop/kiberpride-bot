// Transactions and raw-SQL helpers. READ COMMITTED everywhere: idempotency and serialisation
// come from unique indexes and conditional UPDATEs, not from SERIALIZABLE (decision 003 §4).
import { setTimeout as sleep } from 'node:timers/promises';
import { Prisma, type Db, type Tx } from './client.js';

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    // A second press waits on the first one's row lock; give it room before giving up.
    maxWait: 10_000,
    timeout: 15_000,
  });
}

const RETRY_ATTEMPTS = 3;

/**
 * `withTx` that re-runs the whole transaction when Postgres aborted it as a deadlock victim
 * (40P01) or on a serialization failure (40001). For transitions whose lock order cannot be made
 * global — a match starting withdraws its players from other recruitments (decision 011). The
 * retried function re-reads everything, so it may now fail with an ordinary domain refusal.
 */
export async function withTxRetry<T>(db: Db, fn: (tx: Tx) => Promise<T>, attempts = RETRY_ATTEMPTS): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTx(db, fn);
    } catch (err) {
      if (attempt >= attempts || !isRetryableConflict(err)) throw err;
      await sleep(10 * attempt + Math.floor(Math.random() * 40)); // jitter: the two losers must not collide again
    }
  }
}

/** Deadlock victim (40P01) or serialization failure (40001); Prisma's own name for both is P2034. */
export function isRetryableConflict(err: unknown): boolean {
  const state = sqlState(err);
  return hasCode(err, 'P2034') || state === '40P01' || state === '40001';
}

export function txRunner(db: Db): TxRunner {
  return (fn) => withTx(db, fn);
}

/**
 * True when a write failed on a unique constraint, whether it came from the query builder
 * (P2002) or from raw SQL through the driver adapter (Postgres SQLSTATE 23505).
 */
export function isUniqueViolation(err: unknown): boolean {
  return hasCode(err, 'P2002') || sqlState(err) === '23505';
}

/** True when a write failed on a CHECK constraint (SQLSTATE 23514). */
export function isCheckViolation(err: unknown): boolean {
  return sqlState(err) === '23514';
}

function hasCode(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

// The adapter reports the driver error under meta.driverAdapterError.cause (Prisma 7); older
// shapes put the SQLSTATE in meta.code. Both are read defensively.
function sqlState(err: unknown): string | undefined {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = err.meta;
  const cause = (meta?.driverAdapterError as { cause?: Record<string, unknown> } | undefined)?.cause;
  const candidates = [cause?.originalCode, cause?.code, meta?.code];
  // SQLSTATEs are five characters of [0-9A-Z]: «40P01» (deadlock) is not all digits.
  return candidates.find((c): c is string => typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c));
}
