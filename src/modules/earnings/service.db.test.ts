// The daily bonus and voice time against a real Postgres (decision 014 §5–§6): concurrent claims
// and overlapping ticks pay once, the cap holds, a Moscow day resets. sum(ledger) = balance after
// every test.
import { describe, expect, it } from 'vitest';
import { testDb } from '../../../tests/db/helpers.js';
import { recordingLogging, TestClock } from '../../../tests/db/matches/harness.js';
import { createEconomyService } from '../economy/service.js';
import { createSettingsService } from '../settings/service.js';
import { createEarningsService } from './service.js';

const U = '300000000000000001';
const V = '300000000000000002';

function setup(at = '2026-09-20T12:00:00Z') {
  const db = testDb();
  const clock = new TestClock(new Date(at));
  const settings = createSettingsService(db);
  const logging = recordingLogging();
  const earnings = createEarningsService({ db, economy: createEconomyService(db), settings, logging, clock });
  return { earnings, clock, settings, logging };
}

async function expectLedgerMatchesBalances(): Promise<void> {
  const drift = await testDb().$queryRaw<{ id: string; balance: number; ledger: bigint | null }[]>`
    SELECT u."id", u."balance", (SELECT sum(t."amount") FROM "KpTransaction" t WHERE t."userId" = u."id") AS ledger FROM "User" u`;
  for (const d of drift) expect({ user: d.id, balance: d.balance }).toEqual({ user: d.id, balance: Number(d.ledger ?? 0) });
}

describe('daily bonus (014 §5)', () => {
  it('ten concurrent claims pay once; the rest are ALREADY_CLAIMED with the next Moscow midnight', async () => {
    const { earnings } = setup('2026-09-20T12:00:00Z');
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => earnings.claimDaily(U)));
    const ok = settled.filter((s) => s.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    for (const s of settled) {
      if (s.status === 'rejected') {
        expect(s.reason).toMatchObject({ code: 'ALREADY_CLAIMED', params: { at: new Date('2026-09-20T21:00:00Z') } });
      }
    }
    const rows = await testDb().kpTransaction.findMany({ where: { userId: U } });
    expect(rows.map((r) => [r.reference, r.amount, r.kind])).toEqual([[`daily:${U}:2026-09-20`, 50, 'DAILY_BONUS']]);
    expect(await earnings.dailyStatus(U)).toMatchObject({ amount: 50, claimed: true });
    await expectLedgerMatchesBalances();
  });

  it('counts days in Moscow time: 20:59 UTC is still today, 21:00 UTC is tomorrow', async () => {
    const { earnings, clock } = setup('2026-09-20T20:59:00Z');
    await earnings.claimDaily(U);
    await expect(earnings.claimDaily(U)).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });
    clock.advance(60_000);
    const next = await earnings.claimDaily(U);
    expect(next.balanceAfter).toBe(100);
    expect(next.nextAt).toEqual(new Date('2026-09-21T21:00:00Z'));
    await expectLedgerMatchesBalances();
  });

  it('0 switches it off; the amount comes from settings', async () => {
    const { earnings, settings } = setup();
    await settings.update({ dailyBonusAmount: 0 });
    await expect(earnings.claimDaily(U)).rejects.toMatchObject({ code: 'DAILY_OFF' });
    await settings.update({ dailyBonusAmount: 75 });
    expect((await earnings.claimDaily(U)).amount).toBe(75);
    await expectLedgerMatchesBalances();
  });
});

describe('voice time (014 §6)', () => {
  it('overlapping ticks of one minute credit it once', async () => {
    const { earnings, clock } = setup();
    await Promise.all(Array.from({ length: 5 }, () => earnings.voiceTick([U, V], clock.now())));
    const rows = await testDb().voiceDay.findMany({ orderBy: { userId: 'asc' } });
    expect(rows.map((r) => [r.userId, r.minutes])).toEqual([
      [U, 1],
      [V, 1],
    ]);
  });

  it('pays each full hour once, up to the daily cap, then nothing more that day', async () => {
    const { earnings, clock, logging } = setup('2026-09-20T03:00:00Z');
    let paid = 0;
    for (let minute = 0; minute < 7 * 60 + 5; minute++) {
      // Two overlapping ticks every minute: the second must neither credit nor pay.
      const [a, b] = await Promise.all([earnings.voiceTick([U], clock.now()), earnings.voiceTick([U], clock.now())]);
      paid += a.paid.length + b.paid.length;
      clock.advance(60_000);
    }
    expect(paid).toBe(6); // 60 KP cap / 10 KP an hour
    const rows = await testDb().kpTransaction.findMany({ where: { userId: U }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.reference)).toEqual([1, 2, 3, 4, 5, 6].map((h) => `voice:${U}:2026-09-20:${h}`));
    expect(rows.every((r) => r.amount === 10 && r.kind === 'VOICE_TIME')).toBe(true);
    expect((await testDb().voiceDay.findFirstOrThrow()).minutes).toBe(7 * 60 + 5);
    expect(logging.events.filter((e) => e.audit)).toEqual([]); // never to the log channel (014 §11)
    await expectLedgerMatchesBalances();
  });

  it('59 minutes pay nothing; minutes do not cross Moscow midnight', async () => {
    const { earnings, clock } = setup('2026-09-20T20:01:00Z'); // 23:01 MSK
    for (let i = 0; i < 59; i++) {
      await earnings.voiceTick([U], clock.now());
      clock.advance(60_000);
    }
    expect(await testDb().kpTransaction.count()).toBe(0);
    await earnings.voiceTick([U], clock.now()); // 00:00 MSK: a new day, minute 1
    const days = await testDb().voiceDay.findMany({ orderBy: { day: 'asc' } });
    expect(days.map((d) => [d.day, d.minutes])).toEqual([
      ['2026-09-20', 59],
      ['2026-09-21', 1],
    ]);
    expect(await testDb().kpTransaction.count()).toBe(0);
  });

  it('pays nothing when voice pay is switched off', async () => {
    const { earnings, clock, settings } = setup();
    await settings.update({ voiceKpPerHour: 0 });
    for (let i = 0; i < 61; i++) {
      await earnings.voiceTick([U], clock.now());
      clock.advance(60_000);
    }
    expect(await testDb().kpTransaction.count()).toBe(0);
  });
});
