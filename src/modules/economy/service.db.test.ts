// economy.move against a real Postgres (decisions 002 §8, 003 §4). These tests are what makes
// «a reward cannot be paid twice» and «a balance never goes negative» true, not the code.
import { describe, expect, it } from 'vitest';
import { isDomainError, type DomainError } from '../../core/errors.js';
import { isCheckViolation, withTx } from '../../db/tx.js';
import { testDb } from '../../../tests/db/helpers.js';
import type { MemberFacts } from '../permissions/service.js';
import { ADMIN_ADJUST_DEFAULT_REASON, ADMIN_ADJUST_MAX, createEconomyService, TxKind, type AdminAdjustInput, type MoveInput } from './service.js';

const USER = '300000000000000001';
const ROLE = '600000000000000001';

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

  // Two interactions of a brand-new player at once (/баланс and a reward, say). `upsert` with an
  // empty `update` read-then-inserted and threw on the primary key; found by the 021 tests.
  it('creates a first-contact user row once, whatever arrives at the same moment', async () => {
    const economy = createEconomyService(testDb());
    const results = await Promise.all(Array.from({ length: 5 }, () => economy.ensureUser(USER)));
    expect(results.map((r) => r.balance)).toEqual([0, 0, 0, 0, 0]);
    expect(await testDb().user.count({ where: { id: USER } })).toBe(1);
  });

  it('keeps history newest first', async () => {
    const economy = createEconomyService(testDb());
    await economy.move(credit('admin:a', 10));
    await economy.move(credit('admin:b', 20));
    const history = await economy.history(USER, 5);
    expect(history.map((h) => h.reference)).toEqual(['admin:b', 'admin:a']);
  });
});

describe('historyPage (decision 014 §10)', () => {
  it('pages ten lines at a time, newest first, and clamps a page out of range', async () => {
    const economy = createEconomyService(testDb());
    for (let i = 1; i <= 23; i++) await economy.move(credit(`admin:h${i}`, i));
    const first = await economy.historyPage(USER, 1);
    expect(first).toMatchObject({ page: 1, pages: 3, total: 23 });
    expect(first.entries.map((e) => e.reference)).toEqual(Array.from({ length: 10 }, (_, i) => `admin:h${23 - i}`));
    const last = await economy.historyPage(USER, 99);
    expect(last.page).toBe(3);
    expect(last.entries.map((e) => e.reference)).toEqual(['admin:h3', 'admin:h2', 'admin:h1']);
    expect(await economy.historyPage('300000000000000077', 1)).toMatchObject({ page: 1, pages: 1, total: 0, entries: [] });
  });
});

describe('devTopUp (decision 014 §12)', () => {
  const owner = { userId: USER, roleIds: [], isGuildOwner: true, isAdministrator: false };

  it('pays +10 000 once per nonce, even for five presses at once', async () => {
    const economy = createEconomyService(testDb());
    const results = await Promise.all(Array.from({ length: 5 }, () => economy.devTopUp(owner, 'nonce-abc123', 'development')));
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    await economy.devTopUp(owner, 'nonce-def456', 'development');
    const s = await state();
    expect(s.balance).toBe(20_000);
    expect(s.rows.map((r) => r.reference).sort()).toEqual(['dev:nonce-abc123', 'dev:nonce-def456']);
    expect(s.ledgerSum).toBe(s.balance);
  });

  it('refuses anyone but the guild owner, and everyone in production', async () => {
    const economy = createEconomyService(testDb());
    await expect(economy.devTopUp({ ...owner, isGuildOwner: false, isAdministrator: true }, 'nonce-abc123', 'development')).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
    await expect(economy.devTopUp(owner, 'nonce-abc123', 'production')).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect((await state()).rows).toHaveLength(0);
  });
});

// `/начислить` (decision 021). What makes «an administrator cannot pay twice, cannot take more
// than there is, and cannot do it at all without the right» true is this block, not the code.
describe('adminAdjust (decision 021)', () => {
  const ADMIN: MemberFacts = { userId: '100000000000000009', roleIds: [], isGuildOwner: false, isAdministrator: true };
  const PLAYER: MemberFacts = { userId: '100000000000000010', roleIds: [ROLE], isGuildOwner: false, isAdministrator: false };

  const adjust = (over: Partial<AdminAdjustInput> = {}): AdminAdjustInput => ({ userId: USER, amount: 500, nonce: 'nonce-grant01', ...over });

  it('pays once per invocation, even when the same one is delivered five times', async () => {
    const economy = createEconomyService(testDb());

    const results = await Promise.all(Array.from({ length: 5 }, () => economy.adminAdjust(ADMIN, adjust({ reason: 'приз за турнир' }))));

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
    const s = await state();
    expect(s.rows).toHaveLength(1);
    expect(s.balance).toBe(500);
    expect(s.ledgerSum).toBe(s.balance);
    expect(s.rows[0]).toMatchObject({
      reference: 'admin:nonce-grant01',
      kind: TxKind.ADMIN_ADJUST,
      description: 'приз за турнир', // the history line reads «+500 KP Coin — приз за турнир»
      actorId: ADMIN.userId,
      balanceAfter: 500,
    });
  });

  it('a second invocation is a second payment: a fresh nonce, a fresh line', async () => {
    const economy = createEconomyService(testDb());
    await economy.adminAdjust(ADMIN, adjust());
    await economy.adminAdjust(ADMIN, adjust({ nonce: 'nonce-grant02', amount: 250 }));
    const s = await state();
    expect(s.balance).toBe(750);
    expect(s.rows.map((r) => r.reference).sort()).toEqual(['admin:nonce-grant01', 'admin:nonce-grant02']);
    expect(s.ledgerSum).toBe(s.balance);
  });

  it('takes KP away with a negative amount, down to zero', async () => {
    const economy = createEconomyService(testDb());
    await economy.adminAdjust(ADMIN, adjust({ amount: 500 }));
    const taken = await economy.adminAdjust(ADMIN, adjust({ nonce: 'nonce-grant03', amount: -500, reason: 'ошибка в начислении' }));
    expect(taken.entry.balanceAfter).toBe(0);
    const s = await state();
    expect(s.balance).toBe(0);
    expect(s.ledgerSum).toBe(s.balance);
  });

  it('refuses taking more than the player has, says how much there is, and writes nothing', async () => {
    const economy = createEconomyService(testDb());
    await economy.adminAdjust(ADMIN, adjust({ amount: 120 }));

    const error = await economy.adminAdjust(ADMIN, adjust({ nonce: 'nonce-grant04', amount: -500 })).then(
      () => null,
      (err: unknown) => err as DomainError,
    );

    expect(error).toMatchObject({ code: 'BALANCE_TOO_LOW', params: { balance: 120 } });
    const s = await state();
    expect(s.balance).toBe(120);
    expect(s.rows.map((r) => r.reference)).toEqual(['admin:nonce-grant01']);
    expect(s.ledgerSum).toBe(s.balance);
  });

  it('refuses an actor without ECONOMY_ADMIN and writes nothing', async () => {
    const economy = createEconomyService(testDb());
    await expect(economy.adminAdjust(PLAYER, adjust())).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect((await state()).rows).toHaveLength(0);
  });

  it('lets a role granted ECONOMY_ADMIN do it — the right is data, not the command list', async () => {
    const db = testDb();
    const economy = createEconomyService(db);
    await db.roleCapability.create({ data: { roleId: ROLE, capability: 'ECONOMY_ADMIN' } });
    expect((await economy.adminAdjust(PLAYER, adjust())).applied).toBe(true);
    expect((await state()).balance).toBe(500);
  });

  it('refuses a bot as the target', async () => {
    const economy = createEconomyService(testDb());
    await expect(economy.adminAdjust(ADMIN, adjust({ targetIsBot: true }))).rejects.toMatchObject({ code: 'TARGET_IS_BOT' });
    expect((await state()).rows).toHaveLength(0);
  });

  it('refuses zero and anything past a million, in either direction', async () => {
    const economy = createEconomyService(testDb());
    for (const amount of [0, ADMIN_ADJUST_MAX + 1, -ADMIN_ADJUST_MAX - 1, 1.5]) {
      await expect(economy.adminAdjust(ADMIN, adjust({ amount }))).rejects.toMatchObject({ code: 'AMOUNT_INVALID' });
    }
    expect((await state()).rows).toHaveLength(0);
  });

  it('writes «начислено администратором» when the administrator gave no reason', async () => {
    const economy = createEconomyService(testDb());
    await economy.adminAdjust(ADMIN, adjust({ reason: '   ' }));
    expect((await state()).rows[0]?.description).toBe(ADMIN_ADJUST_DEFAULT_REASON);
  });

  it('lets an administrator pay themselves — deliberate, and the ledger names them', async () => {
    const economy = createEconomyService(testDb());
    const self = await economy.adminAdjust(ADMIN, adjust({ userId: ADMIN.userId }));
    expect(self.applied).toBe(true);
    const row = await testDb().kpTransaction.findUniqueOrThrow({ where: { reference: 'admin:nonce-grant01' } });
    expect(row).toMatchObject({ userId: ADMIN.userId, actorId: ADMIN.userId, amount: 500 });
  });

  it('serialises concurrent takings: the balance never goes below zero', async () => {
    const economy = createEconomyService(testDb());
    await economy.adminAdjust(ADMIN, adjust({ amount: 100 }));

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => economy.adminAdjust(ADMIN, adjust({ nonce: `nonce-take0${i}`, amount: -30 }))),
    );

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of settled.filter((r) => r.status === 'rejected')) expect((r.reason as DomainError).code).toBe('BALANCE_TOO_LOW');
    const s = await state();
    expect(s.balance).toBe(10);
    expect(s.ledgerSum).toBe(s.balance);
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
