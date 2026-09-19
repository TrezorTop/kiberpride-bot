// economy.move against a real Postgres (decisions 002 §8, 003 §4). These tests are what makes
// «a reward cannot be paid twice» and «a balance never goes negative» true, not the code.
import { describe, expect, it } from 'vitest';
import { isDomainError, type DomainError } from '../../core/errors.js';
import { isCheckViolation, withTx } from '../../db/tx.js';
import { testDb } from '../../../tests/db/helpers.js';
import { createEconomyService, TxKind, type MoveInput } from './service.js';

const USER = '300000000000000001';

const credit = (reference: string, amount: number): MoveInput => ({
  userId: USER,
  amount,
  kind: TxKind.ADMIN_ADJUST,
  reference,
  description: 'тестовое начисление',
});

async function state() {
  const db = testDb();
  const user = await db.user.findUnique({ where: { id: USER } });
  const rows = await db.kpTransaction.findMany({ where: { userId: USER } });
  return { balance: user?.balance ?? null, rows, ledgerSum: rows.reduce((s, r) => s + r.amount, 0) };
}

describe('economy.move', () => {
  it('applies ten concurrent moves with one reference exactly once', async () => {
    const economy = createEconomyService(testDb());
    const input = credit(`match:1:win:${USER}`, 100);

    // Ten independent transactions, each on its own pool connection, like ten button presses.
    const results = await Promise.all(Array.from({ length: 10 }, () => economy.move(input)));

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
    const s = await state();
    expect(s.rows).toHaveLength(1);
    expect(s.balance).toBe(100);
    expect(s.ledgerSum).toBe(s.balance);
    expect(s.rows[0]?.balanceAfter).toBe(100);
  });

  it('never lets concurrent debits take the balance below zero', async () => {
    const economy = createEconomyService(testDb());
    await economy.move(credit('admin:seed', 100));

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => economy.move({ ...credit(`admin:debit-${i}`, -30), kind: TxKind.PURCHASE })),
    );

    const ok = settled.filter((r) => r.status === 'fulfilled');
    const refused = settled.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    for (const r of refused) expect((r.reason as DomainError).code).toBe('INSUFFICIENT_FUNDS');
    const s = await state();
    expect(s.balance).toBe(10);
    expect(s.rows).toHaveLength(4);
    expect(s.ledgerSum).toBe(s.balance);
  });

  it('refuses a debit larger than the balance and leaves nothing behind', async () => {
    const economy = createEconomyService(testDb());
    await economy.move(credit('admin:seed', 50));

    await expect(economy.move(credit('admin:too-much', -100))).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    const s = await state();
    expect(s.balance).toBe(50);
    expect(s.rows.map((r) => r.reference)).toEqual(['admin:seed']);
    expect(s.ledgerSum).toBe(s.balance);

    // The rolled-back reference is free again: the same fact can be applied once funds exist.
    await economy.move(credit('admin:top-up', 60));
    const retry = await economy.move(credit('admin:too-much', -100));
    expect(retry.applied).toBe(true);
    expect(retry.entry.balanceAfter).toBe(10);
  });

  it('joins the caller’s transaction: a later failure in it undoes the move', async () => {
    const db = testDb();
    const economy = createEconomyService(db);

    await expect(
      withTx(db, async (tx) => {
        await economy.move(credit('match:2:participation:x', 25), tx);
        throw new Error('the rest of the finish transaction failed');
      }),
    ).rejects.toThrow('the rest of the finish transaction failed');

    const s = await state();
    expect(s.rows).toHaveLength(0);
    expect(s.balance ?? 0).toBe(0);
  });

  it('refuses a reused reference that carries a different fact, and moves nothing', async () => {
    const economy = createEconomyService(testDb());
    await economy.move(credit('match:3:win:x', 100));

    const mismatches: MoveInput[] = [
      credit('match:3:win:x', 50), // amount
      { ...credit('match:3:win:x', 100), kind: TxKind.MATCH_WIN }, // kind
      { ...credit('match:3:win:x', 100), userId: '300000000000000002' }, // user
    ];
    for (const input of mismatches) {
      const error = await economy.move(input).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      expect(isDomainError(error)).toBe(false);
      expect(String(error)).toContain('match:3:win:x');
    }

    // The exact same fact is still the ordinary idempotent no-op.
    expect((await economy.move(credit('match:3:win:x', 100))).applied).toBe(false);
    const s = await state();
    expect(s.rows).toHaveLength(1);
    expect(s.balance).toBe(100);
  });

  it('keeps history newest first', async () => {
    const economy = createEconomyService(testDb());
    await economy.move(credit('admin:a', 10));
    await economy.move(credit('admin:b', 20));
    const history = await economy.history(USER, 5);
    expect(history.map((h) => h.reference)).toEqual(['admin:b', 'admin:a']);
  });
});

describe('User balance CHECK constraint (raw SQL in the init migration)', () => {
  it('fires on a raw write that would make a balance negative', async () => {
    const db = testDb();
    await createEconomyService(db).ensureUser(USER);

    const error = await db.$executeRaw`UPDATE "User" SET "balance" = -1 WHERE "id" = ${USER}`.then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).not.toBeNull();
    expect(isCheckViolation(error) || /User_balance_nonnegative/.test(String(error))).toBe(true);
    expect((await state()).balance).toBe(0);
  });
});
