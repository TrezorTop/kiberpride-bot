// Roster guarantees of spec §6 against a real Postgres (decisions 003 §10, 004, 008 §9, 009 §2):
// no double join, no join after close, concurrent presses never corrupt the roster, a player
// leaving the server is handled in every state. Concurrent calls each run on their own pool
// connection, like real button presses.
import { describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../helpers.js';
import { codeOf, expectInvariants, fill, harness, MANAGER_ROLE, newMatch, ORGANISER, OWNER, player, startedMatch, STRANGER } from './harness.js';

const db = testDb;

describe('join under concurrency', () => {
  it('AUTO: 12 simultaneous joins on 10 seats → exactly 10 players, two refusals, teams 5/5', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'AUTO' });

    const settled = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => h.matches.join(id, player(i + 1))));

    expect(settled.map(codeOf).filter((c) => c !== null)).toEqual(['MATCH_CLOSED', 'MATCH_CLOSED']);
    const m = await db().match.findUniqueOrThrow({ where: { id }, include: { participants: true } });
    expect(m.participants).toHaveLength(10);
    expect(m.participantCount).toBe(10);
    expect(m.status).toBe('IN_PROGRESS');
    expect(m.participants.filter((p) => p.team === 'A')).toHaveLength(5);
    expect(m.participants.filter((p) => p.team === 'B')).toHaveLength(5);
    expect(m.closedAt).not.toBeNull();
    expect(m.startedAt).not.toBeNull();
    await expectInvariants();
  });

  it('MANUAL: 12 simultaneous joins on 10 seats → 10 players, TEAMS_PENDING, no teams yet', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL' });

    const settled = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => h.matches.join(id, player(i + 1))));

    expect(settled.map(codeOf).filter((c) => c !== null)).toEqual(['MATCH_CLOSED', 'MATCH_CLOSED']);
    const m = await db().match.findUniqueOrThrow({ where: { id }, include: { participants: true } });
    expect(m.participants).toHaveLength(10);
    expect(m.participantCount).toBe(10);
    expect(m.status).toBe('TEAMS_PENDING');
    expect(m.participants.every((p) => p.team === null)).toBe(true);
    await expectInvariants();
  });

  it('the same player pressing «join» twice at once is signed up once', async () => {
    const h = await harness();
    const id = await newMatch(h);

    const settled = await Promise.allSettled([h.matches.join(id, player(1)), h.matches.join(id, player(1))]);

    expect(settled.map(codeOf).sort()).toEqual(['ALREADY_JOINED', null].sort());
    expect(await db().participant.count({ where: { matchId: id } })).toBe(1);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).participantCount).toBe(1);
  });

  it('a second join after success says «already joined» and changes nothing', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await h.matches.join(id, player(1));
    const before = await db().match.findUniqueOrThrow({ where: { id } });
    await expect(h.matches.join(id, player(1))).rejects.toMatchObject({ code: 'ALREADY_JOINED' });
    const after = await db().match.findUniqueOrThrow({ where: { id } });
    expect(after.version).toBe(before.version);
    expect(after.participantCount).toBe(1);
  });

  it('interleaved concurrent joins and leaves keep participantCount = rows', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamSize: 10 }); // 20 seats: nobody is refused for lack of room
    await fill(h, id, 6, 1);

    const ops = [
      ...[1, 2, 3, 4, 5, 6].map((k) => h.matches.leave(id, player(k))),
      ...[7, 8, 9, 10, 11, 12].map((k) => h.matches.join(id, player(k))),
      ...[1, 3, 5].map((k) => h.matches.join(id, player(k))), // may land before or after their leave
    ];
    await Promise.allSettled(ops);

    await expectInvariants();
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.status).toBe('RECRUITING');
  });

  it('leaving a match you are not in is refused and moves nothing', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await fill(h, id, 2);
    await expect(h.matches.leave(id, player(9))).rejects.toMatchObject({ code: 'NOT_IN_MATCH' });
    expect((await db().match.findUniqueOrThrow({ where: { id } })).participantCount).toBe(2);
  });

  it('a join after the roster closed is refused', async () => {
    const h = await harness();
    const { id } = await startedMatch(h);
    await expect(h.matches.join(id, player(99))).rejects.toMatchObject({ code: 'MATCH_CLOSED' });
  });
});

describe('one started match at a time (decision 009 §2)', () => {
  it('refuses a join while the player is in an IN_PROGRESS match', async () => {
    const h = await harness();
    await startedMatch(h, { teamSize: 2 }); // players 1..4 now playing
    const other = await newMatch(h, { teamSize: 2 });
    await expect(h.matches.join(other, player(1))).rejects.toMatchObject({ code: 'BUSY_IN_MATCH' });
    expect(await db().participant.count({ where: { matchId: other } })).toBe(0);
    await expectInvariants();
  });

  it('allows sign-ups to several recruitments at once', async () => {
    const h = await harness();
    const x = await newMatch(h, { teamSize: 2 });
    const y = await newMatch(h, { teamSize: 2 });
    await h.matches.join(x, player(1));
    await h.matches.join(y, player(1));
    expect(await db().participant.count({ where: { userId: player(1) } })).toBe(2);
  });

  it('a player who left the server in their started match is not blocked by it', async () => {
    const h = await harness();
    await startedMatch(h, { teamSize: 2 });
    await h.matches.memberLeft(player(1));
    const other = await newMatch(h, { teamSize: 2 });
    await expect(h.matches.join(other, player(1))).resolves.toMatchObject({ participantCount: 1 });
  });
});

describe('a start withdraws its players from other recruitments (decision 011)', () => {
  it('AUTO: the last seat of x takes x’s players out of recruiting y; y stays consistent', async () => {
    const h = await harness();
    const x = await newMatch(h, { teamSize: 2 });
    const y = await newMatch(h, { teamSize: 2 });
    await h.matches.join(y, player(1));
    await h.matches.join(y, player(9));
    await h.matches.join(x, player(1));
    const yBefore = await h.matches.get(y);
    await fill(h, x, 3, 2); // x starts with player 1

    expect((await h.matches.get(x)).status).toBe('IN_PROGRESS');
    const yAfter = await h.matches.get(y);
    expect(yAfter.participants.map((p) => p.userId)).toEqual([player(9)]);
    expect(yAfter).toMatchObject({ status: 'RECRUITING', participantCount: 1, version: yBefore.version + 1 });
    const line = h.logging.events.find((e) => e.name === 'match.withdrawn');
    expect(line?.fields).toMatchObject({ matchId: y, userId: player(1), startedMatchId: x, reopened: false });
    expect(line?.audit).toContain(`выписан из набора #${y} — начался матч #${x}`);
    await expectInvariants();
  });

  it('MANUAL confirm: a TEAMS_PENDING y reopens with its teams cleared and its announcement reset', async () => {
    const h = await harness();
    const x = await newMatch(h, { teamSize: 2, teamMode: 'MANUAL' });
    const y = await newMatch(h, { teamSize: 2, teamMode: 'MANUAL' });
    await fill(h, x, 4, 1); // players 1..4 in x, TEAMS_PENDING
    await h.matches.join(y, player(1)); // allowed: x has not started
    await fill(h, y, 3, 10); // y TEAMS_PENDING too
    await h.matches.assignTeamA(ORGANISER, y, [player(1), player(10)]);
    await db().match.update({ where: { id: y }, data: { announcedStatus: 'TEAMS_PENDING' } });
    const v = await h.matches.assignTeamA(ORGANISER, x, [player(1), player(2)]);

    await h.matches.confirmTeams(ORGANISER, x, v);

    expect((await h.matches.get(x)).status).toBe('IN_PROGRESS');
    const m = await h.matches.get(y);
    expect(m).toMatchObject({ status: 'RECRUITING', participantCount: 3, announcedStatus: null });
    expect(m.participants.map((p) => p.userId).sort()).toEqual([player(10), player(11), player(12)].sort());
    expect(m.participants.every((p) => p.team === null)).toBe(true);
    expect(h.logging.events.find((e) => e.name === 'match.withdrawn')?.fields).toMatchObject({ matchId: y, reopened: true });
    await expectInvariants();
  });

  it('two recruitments sharing players filling at once: both presses settle, nobody plays twice, counts hold', async () => {
    for (let round = 0; round < 8; round++) {
      const h = await harness();
      const x = await newMatch(h, { teamSize: 2 });
      const y = await newMatch(h, { teamSize: 2 });
      const base = round * 100;
      for (const k of [1, 2]) {
        await h.matches.join(x, player(base + k));
        await h.matches.join(y, player(base + k));
      }
      await h.matches.join(x, player(base + 3));
      await h.matches.join(y, player(base + 4));

      const settled = await Promise.allSettled([h.matches.join(x, player(base + 5)), h.matches.join(y, player(base + 6))]);

      expect(settled.map(codeOf)).toEqual([null, null]);
      const playing = await db().participant.findMany({ where: { match: { status: 'IN_PROGRESS' }, leftServerAt: null }, select: { userId: true } });
      const ids = playing.map((p) => p.userId);
      expect(new Set(ids).size).toBe(ids.length);
      const started = (await Promise.all([x, y].map((id) => h.matches.get(id)))).filter((m) => m.status === 'IN_PROGRESS');
      expect(started.length).toBeGreaterThanOrEqual(1);
      await expectInvariants();
      await truncateAll();
    }
  });
});

describe('organiser removes a player', () => {
  it('in TEAMS_PENDING: removed, match reopens, teams cleared, counter down, announcement reset', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    const players = await fill(h, id, 4);
    await h.matches.assignTeamA(ORGANISER, id, [players[0] as string, players[1] as string]);
    await h.matches.sync(id); // announces TEAMS_PENDING
    expect((await db().match.findUniqueOrThrow({ where: { id } })).announcedStatus).toBe('TEAMS_PENDING');
    const before = await db().match.findUniqueOrThrow({ where: { id } });

    await h.matches.removeParticipant(ORGANISER, id, players[2] as string);

    const m = await db().match.findUniqueOrThrow({ where: { id }, include: { participants: true } });
    expect(m.status).toBe('RECRUITING');
    expect(m.participantCount).toBe(3);
    expect(m.participants).toHaveLength(3);
    expect(m.participants.every((p) => p.team === null)).toBe(true);
    expect(m.announcedStatus).toBeNull();
    expect(m.closedAt).toBeNull();
    expect(m.version).toBeGreaterThan(before.version);
    await expectInvariants();

    // The reopened match fills again and announces the pending teams a second time.
    await h.matches.join(id, player(50));
    await h.matches.sync(id);
    expect(h.gateway.announcements.filter((a) => a.status === 'TEAMS_PENDING')).toHaveLength(2);
  });

  it('in RECRUITING: removed and counted down', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await fill(h, id, 3);
    await h.matches.removeParticipant(OWNER, id, player(2));
    expect((await db().match.findUniqueOrThrow({ where: { id } })).participantCount).toBe(2);
    await expectInvariants();
  });

  it('is refused to someone who neither created the match nor manages matches', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await fill(h, id, 1);
    await expect(h.matches.removeParticipant(STRANGER, id, player(1))).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    const manager = { ...STRANGER, roleIds: [MANAGER_ROLE] };
    await expect(h.matches.removeParticipant(manager, id, player(1))).resolves.toBeUndefined();
  });

  it('is refused once the match has started', async () => {
    const h = await harness();
    const { id } = await startedMatch(h);
    await expect(h.matches.removeParticipant(ORGANISER, id, player(1))).rejects.toMatchObject({ code: 'MATCH_STARTED' });
  });

  it('refuses a user who is not on the roster', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await expect(h.matches.removeParticipant(ORGANISER, id, player(1))).rejects.toMatchObject({ code: 'NOT_A_PARTICIPANT' });
  });
});

describe('team picker (MANUAL)', () => {
  async function pending() {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    const players = await fill(h, id, 4);
    return { h, id, players };
  }

  it('assign then confirm starts the match with exactly teamSize per team', async () => {
    const { h, id, players } = await pending();
    const v = await h.matches.assignTeamA(ORGANISER, id, [players[0] as string, players[3] as string]);
    await h.matches.confirmTeams(ORGANISER, id, v);
    const m = await h.matches.get(id);
    expect(m.status).toBe('IN_PROGRESS');
    expect(m.participants.filter((p) => p.team === 'A').map((p) => p.userId).sort()).toEqual([players[0], players[3]].sort());
    expect(m.participants.filter((p) => p.team === 'B')).toHaveLength(2);
  });

  it('confirm with a stale version is refused', async () => {
    const { h, id, players } = await pending();
    const v = await h.matches.assignTeamA(ORGANISER, id, [players[0] as string, players[1] as string]);
    await h.matches.assignTeamA(ORGANISER, id, [players[2] as string, players[3] as string]); // v + 1
    await expect(h.matches.confirmTeams(ORGANISER, id, v)).rejects.toMatchObject({ code: 'STALE_PANEL' });
    expect((await h.matches.get(id)).status).toBe('TEAMS_PENDING');
  });

  it('confirm before any team is picked is refused (wrong counts)', async () => {
    const { h, id } = await pending();
    const v = (await h.matches.get(id)).version;
    await expect(h.matches.confirmTeams(ORGANISER, id, v)).rejects.toMatchObject({ code: 'TEAMS_NOT_READY' });
  });

  it('confirm with uneven teams (written behind the service) is refused', async () => {
    const { h, id, players } = await pending();
    const v = await h.matches.assignTeamA(ORGANISER, id, [players[0] as string, players[1] as string]);
    await db().participant.updateMany({ where: { matchId: id, userId: players[2] }, data: { team: 'A' } });
    await expect(h.matches.confirmTeams(ORGANISER, id, v)).rejects.toMatchObject({ code: 'TEAMS_NOT_READY' });
  });

  it('a pick of the wrong size or with an outsider is refused', async () => {
    const { h, id, players } = await pending();
    await expect(h.matches.assignTeamA(ORGANISER, id, [players[0] as string])).rejects.toMatchObject({ code: 'TEAMS_NOT_READY' });
    await expect(h.matches.assignTeamA(ORGANISER, id, [players[0] as string, player(77)])).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });
});

describe('a player leaves the Discord server (004 §5, 008 §9)', () => {
  it('RECRUITING: removed like a leave, version bumped', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await fill(h, id, 3);
    const before = await db().match.findUniqueOrThrow({ where: { id } });
    expect(await h.matches.memberLeft(player(2))).toEqual([id]);
    const after = await db().match.findUniqueOrThrow({ where: { id } });
    expect(after.participantCount).toBe(2);
    expect(after.version).toBe(before.version + 1);
    await expectInvariants();
  });

  it('TEAMS_PENDING: removed and the match reopens, version bumped', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    await fill(h, id, 4);
    const before = await db().match.findUniqueOrThrow({ where: { id } });
    await h.matches.memberLeft(player(1));
    const after = await db().match.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('RECRUITING');
    expect(after.participantCount).toBe(3);
    expect(after.version).toBe(before.version + 1);
    await expectInvariants();
  });

  it('IN_PROGRESS: stays on the roster marked as left, version bumped so a finish panel goes stale', async () => {
    const h = await harness();
    const { id, version } = await startedMatch(h, { teamSize: 2 });
    await h.matches.memberLeft(player(1));
    const after = await db().match.findUniqueOrThrow({ where: { id }, include: { participants: true } });
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.participantCount).toBe(4);
    expect(after.participants.find((p) => p.userId === player(1))?.leftServerAt).not.toBeNull();
    expect(after.version).toBe(version + 1);
    await expect(h.matches.finish(ORGANISER, { id, version, winner: 'A', mvpUserId: null })).rejects.toMatchObject({ code: 'STALE_PANEL' });

    // A second event for the same departure changes nothing.
    await h.matches.memberLeft(player(1));
    expect((await db().match.findUniqueOrThrow({ where: { id } })).version).toBe(version + 1);
  });

  it('reconcileMembership finds players who left while the bot was offline, skipping fake ids', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await fill(h, id, 3);
    await h.matches.addTestPlayers(OWNER, id);
    h.gateway.absent.add(player(2));
    expect(await h.matches.reconcileMembership()).toEqual([player(2)]);
    expect(h.gateway.leaks).toEqual([]);
    expect(await db().participant.count({ where: { matchId: id, userId: player(2) } })).toBe(0);
  });
});

describe('test players (008 §10)', () => {
  it('fill the match to capacity − 1 through the real join path, so the owner closes it', async () => {
    const h = await harness();
    const id = await newMatch(h);
    expect(await h.matches.addTestPlayers(OWNER, id)).toBe(9);
    await h.matches.join(id, OWNER.userId);
    const m = await h.matches.get(id);
    expect(m.status).toBe('IN_PROGRESS');
    await expectInvariants();
  });

  it('skip fake players who are busy in another started test match', async () => {
    const h = await harness();
    const first = await newMatch(h, { teamSize: 2 });
    await h.matches.addTestPlayers(OWNER, first);
    await h.matches.join(first, OWNER.userId); // fakes 1..3 now IN_PROGRESS
    const second = await newMatch(h, { teamSize: 2 });
    expect(await h.matches.addTestPlayers(OWNER, second)).toBe(3);
    const ids = (await h.matches.get(second)).participants.map((p) => p.userId);
    expect(ids).not.toContain('00000000000000001');
  });

  it('are refused in production and to anyone but the guild owner', async () => {
    const prod = await harness({ nodeEnv: 'production' });
    const id = await newMatch(prod);
    await expect(prod.matches.addTestPlayers(OWNER, id)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(prod.matches.addTestPlayers({ ...OWNER, isGuildOwner: false, isAdministrator: true }, id)).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    });
  });
});
