// Finishing and paying (decisions 004 §4, 007, 009 §1, §3): no finish twice, no reward twice,
// no MVP who did not play, no winner before teams, amounts from the snapshot, ×2, «без MVP».
import { describe, expect, it } from 'vitest';
import { createEconomyService } from '../../../src/modules/economy/service.js';
import { testDb } from '../helpers.js';
import { codeOf, expectInvariants, fill, harness, ledgerFor, newMatch, ORGANISER, player, startedMatch, STRANGER } from './harness.js';

const db = testDb;
const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

describe('finish', () => {
  it('pays participation to all, the win to the winners and MVP to the MVP — once', async () => {
    const h = await harness();
    const { id, version, a } = await startedMatch(h);
    const mvp = a[0] as string;

    const result = await h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: mvp });

    const rows = await ledgerFor(id);
    expect(rows.filter((r) => r.kind === 'MATCH_PARTICIPATION')).toHaveLength(10);
    expect(rows.filter((r) => r.kind === 'MATCH_WIN').map((r) => r.userId).sort()).toEqual([...a].sort());
    expect(rows.filter((r) => r.kind === 'MATCH_MVP').map((r) => r.userId)).toEqual([mvp]);
    expect(sum(rows)).toBe(10 * 25 + 5 * 100 + 50);
    expect(result.paid).toHaveLength(rows.length);
    expect(result.withheld).toHaveLength(0);
    expect(rows.find((r) => r.kind === 'MATCH_WIN')?.description).toBe(`победа в CS2 · матч #${id}`);
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m).toMatchObject({ status: 'FINISHED', winner: 'A', mvpUserId: mvp, endedById: ORGANISER.userId });
    await expectInvariants();
  });

  it('writes the ledger in ascending userId order', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h);
    await h.matches.finish(ORGANISER, { id, version, winner: 'B', mvpUserId: null });
    const users = (await ledgerFor(id)).map((r) => r.userId);
    expect(users).toEqual([...users].sort());
  });

  it('two concurrent finishes of the same version: one pays, the other is refused', async () => {
    const h = await harness();
    const { id, version, a, b } = await startedMatch(h);

    const settled = await Promise.allSettled([
      h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: a[0] as string }),
      h.matches.finish(ORGANISER, { id, version, winner: 'B', mvpUserId: b[0] as string }),
    ]);

    expect(settled.map(codeOf).filter((c) => c !== null)).toEqual(['MATCH_ALREADY_FINISHED']);
    const rows = await ledgerFor(id);
    expect(rows.filter((r) => r.kind === 'MATCH_WIN')).toHaveLength(5);
    expect(rows.filter((r) => r.kind === 'MATCH_MVP')).toHaveLength(1);
    expect(rows).toHaveLength(16);
    await expectInvariants();
  });

  it('a replayed confirm is refused by the status guard and a replayed reference is a no-op', async () => {
    const h = await harness();
    const { id, version, a } = await startedMatch(h);
    const { paid } = await h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: a[0] as string });

    await expect(h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: a[0] as string })).rejects.toMatchObject({
      code: 'MATCH_ALREADY_FINISHED',
    });
    // The second layer: even if code paid again, the reference makes it a no-op.
    const economy = createEconomyService(db());
    const line = paid[0]!;
    const replay = await economy.move({ ...line, matchId: id });
    expect(replay.applied).toBe(false);
    expect(await ledgerFor(id)).toHaveLength(paid.length);
    await expectInvariants();
  });

  it('withholds the rewards of a player who left, and a later manual payment by the same reference applies once', async () => {
    const h = await harness();
    const { id, a } = await startedMatch(h);
    const gone = a[0] as string;
    await h.matches.memberLeft(gone);
    const version = (await h.matches.get(id)).version;

    const { withheld } = await h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: gone });

    expect(withheld.map((l) => l.reference).sort()).toEqual(
      [`match:${id}:participation:${gone}`, `match:${id}:win:${gone}`, `match:${id}:mvp:${gone}`].sort(),
    );
    expect((await ledgerFor(id)).filter((r) => r.userId === gone)).toHaveLength(0);
    const logged = h.logging.events.filter((e) => e.name === 'match.reward_withheld').map((e) => e.fields.reference);
    expect(logged.sort()).toEqual(withheld.map((l) => l.reference).sort());

    // Manual payment from the admin panel uses the SAME reference (004 §5): twice → once.
    const economy = createEconomyService(db());
    const line = withheld.find((l) => l.event === 'win')!;
    const first = await economy.move({ ...line, matchId: id });
    const second = await economy.move({ ...line, matchId: id });
    expect([first.applied, second.applied]).toEqual([true, false]);
    expect((await db().user.findUniqueOrThrow({ where: { id: gone } })).balance).toBe(100);
    await expectInvariants();
  });

  it('refuses an MVP who is not on the roster, and moves nothing', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h);
    await expect(h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: player(99) })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
    expect(await ledgerFor(id)).toHaveLength(0);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
  });

  it('refuses an MVP who has no team, and moves nothing', async () => {
    const h = await harness();
    const { id, version, a } = await startedMatch(h);
    await db().participant.updateMany({ where: { matchId: id, userId: a[0] }, data: { team: null } });
    await expect(h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: a[0] as string })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
    expect(await ledgerFor(id)).toHaveLength(0);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
  });

  it('«без MVP» pays no MVP reward and records no MVP', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h);
    await h.matches.finish(ORGANISER, { id, version, winner: 'B', mvpUserId: null });
    const rows = await ledgerFor(id);
    expect(rows.filter((r) => r.kind === 'MATCH_MVP')).toHaveLength(0);
    expect(sum(rows)).toBe(10 * 25 + 5 * 100);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).mvpUserId).toBeNull();
  });

  it('refuses a winner before the teams exist (RECRUITING, TEAMS_PENDING)', async () => {
    const h = await harness();
    const recruiting = await newMatch(h);
    await expect(
      h.matches.finish(ORGANISER, { id: recruiting, version: (await h.matches.get(recruiting)).version, winner: 'A', mvpUserId: null }),
    ).rejects.toMatchObject({ code: 'TEAMS_NOT_READY' });

    const pending = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    await fill(h, pending, 4);
    await expect(
      h.matches.finish(ORGANISER, { id: pending, version: (await h.matches.get(pending)).version, winner: 'A', mvpUserId: null }),
    ).rejects.toMatchObject({ code: 'TEAMS_NOT_READY' });
    expect(await db().kpTransaction.count()).toBe(0);
  });

  it('refuses a stale version and a member without rights', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h);
    await expect(h.matches.finish(ORGANISER, { id, version: version - 1, winner: 'A', mvpUserId: null })).rejects.toMatchObject({
      code: 'STALE_PANEL',
    });
    await expect(h.matches.finish(STRANGER, { id, version, winner: 'A', mvpUserId: null })).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect(await ledgerFor(id)).toHaveLength(0);
  });

  it('DRAW with a 0 amount writes no draw rows; only participation is paid', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h);
    await h.matches.finish(ORGANISER, { id, version, winner: 'DRAW', mvpUserId: null });
    const rows = await ledgerFor(id);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.kind === 'MATCH_PARTICIPATION')).toBe(true);
  });

  it('DRAW with a positive amount pays it to both teams', async () => {
    const h = await harness();
    await db().rewardRule.updateMany({ where: { event: 'DRAW', gameId: null }, data: { amount: 40 } });
    const { id, version } = await startedMatch(h);
    await h.matches.finish(ORGANISER, { id, version, winner: 'DRAW', mvpUserId: null });
    const draws = (await ledgerFor(id)).filter((r) => r.reference.includes(':draw:'));
    expect(draws).toHaveLength(10);
    expect(draws.every((r) => r.amount === 40 && r.kind === 'MATCH_BONUS')).toBe(true);
    await expectInvariants();
  });

  it('pays the amounts snapshotted at creation, not a rule changed afterwards', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await db().rewardRule.updateMany({ where: { event: 'WIN', gameId: null }, data: { amount: 999 } });
    await db().rewardRule.create({ data: { event: 'PARTICIPATION', gameId: h.gameId, amount: 7 } });
    await fill(h, id, 10);
    const { version } = await h.matches.get(id);
    await h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: null });
    const rows = await ledgerFor(id);
    expect(new Set(rows.filter((r) => r.kind === 'MATCH_WIN').map((r) => r.amount))).toEqual(new Set([100]));
    expect(new Set(rows.filter((r) => r.kind === 'MATCH_PARTICIPATION').map((r) => r.amount))).toEqual(new Set([25]));
  });

  it('a game’s own rule overrides the default at creation', async () => {
    const h = await harness();
    await db().rewardRule.create({ data: { event: 'WIN', gameId: h.gameId, amount: 150 } });
    const id = await newMatch(h);
    expect((await h.matches.get(id)).rewards).toEqual({ participation: 25, win: 150, mvp: 50, draw: 0 });
  });

  it('two finishes sharing a player, run concurrently, both complete (no deadlock)', async () => {
    const h = await harness();
    // Players 1..4 sign up to both x and y while recruiting; each then fills with its own players.
    const x = await newMatch(h, { teamSize: 5 });
    const y = await newMatch(h, { teamSize: 5 });
    for (let k = 1; k <= 4; k++) {
      await h.matches.join(x, player(k));
      await h.matches.join(y, player(k));
    }
    await fill(h, x, 6, 10);
    await fill(h, y, 6, 20);
    const [sx, sy] = [await h.matches.get(x), await h.matches.get(y)];
    expect([sx.status, sy.status]).toEqual(['IN_PROGRESS', 'IN_PROGRESS']);

    const settled = await Promise.allSettled([
      h.matches.finish(ORGANISER, { id: x, version: sx.version, winner: 'A', mvpUserId: null }),
      h.matches.finish(ORGANISER, { id: y, version: sy.version, winner: 'B', mvpUserId: null }),
    ]);
    expect(settled.map(codeOf)).toEqual([null, null]);
    expect(await ledgerFor(x)).toHaveLength(15);
    expect(await ledgerFor(y)).toHaveLength(15);
    await expectInvariants();
  });
});

describe('⭐ special match ×2 (decision 009 §1)', () => {
  it('doubles every reward while on, and toggling back restores the settings amounts', async () => {
    const h = await harness();
    await db().rewardRule.updateMany({ where: { event: 'DRAW', gameId: null }, data: { amount: 5 } });
    const id = await newMatch(h);
    const v0 = (await h.matches.get(id)).version;

    const v1 = await h.matches.setSpecial(ORGANISER, id, true);
    expect(v1).toBe(v0 + 1);
    expect(await h.matches.get(id)).toMatchObject({ special: true, rewards: { participation: 50, win: 200, mvp: 100, draw: 10 } });

    await h.matches.setSpecial(ORGANISER, id, false);
    expect(await h.matches.get(id)).toMatchObject({ special: false, rewards: { participation: 25, win: 100, mvp: 50, draw: 5 } });
    expect(h.logging.events.filter((e) => e.name === 'match.special')).toHaveLength(2);
  });

  it('a special match pays double at finish', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await h.matches.setSpecial(ORGANISER, id, true);
    await fill(h, id, 10);
    const snap = await h.matches.get(id);
    const mvp = snap.participants.find((p) => p.team === 'A')!.userId;
    await h.matches.finish(ORGANISER, { id, version: snap.version, winner: 'A', mvpUserId: mvp });
    expect(sum(await ledgerFor(id))).toBe(2 * (10 * 25 + 5 * 100 + 50));
    await expectInvariants();
  });

  it('switching to the state it is already in changes nothing', async () => {
    const h = await harness();
    const id = await newMatch(h);
    const v = (await h.matches.get(id)).version;
    expect(await h.matches.setSpecial(ORGANISER, id, false)).toBe(v);
    expect(h.logging.events.filter((e) => e.name === 'match.special')).toHaveLength(0);
  });

  it('is refused outside RECRUITING and to a member without rights', async () => {
    const h = await harness();
    const { id } = await startedMatch(h);
    await expect(h.matches.setSpecial(ORGANISER, id, true)).rejects.toMatchObject({ code: 'SPECIAL_ONLY_RECRUITING' });
    const open = await newMatch(h);
    await expect(h.matches.setSpecial(STRANGER, open, true)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    expect((await h.matches.get(open)).special).toBe(false);
  });
});

describe('cancel', () => {
  it('cancels from any open state with the rendered version; no KP moves', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h);
    await expect(h.matches.cancel(ORGANISER, id, version - 1)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    await h.matches.cancel(ORGANISER, id, version);
    expect(await db().match.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'CANCELLED', endedById: ORGANISER.userId });
    expect(await db().kpTransaction.count()).toBe(0);
    await expect(h.matches.cancel(ORGANISER, id, version + 1)).rejects.toMatchObject({ code: 'MATCH_CANCELLED' });
    const v = (await h.matches.get(id)).version;
    await expect(h.matches.finish(ORGANISER, { id, version: v, winner: 'A', mvpUserId: null })).rejects.toMatchObject({
      code: 'MATCH_CANCELLED',
    });
  });
});
