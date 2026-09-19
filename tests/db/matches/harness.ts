// Wiring for the matches db tests: the real services on the test database, a fake gateway, a
// recording logger, and the invariants every roster/payout test re-checks (003 Consequences).
import { expect } from 'vitest';
import type { Clock } from '../../../src/core/clock.js';
import type { TeamModeName } from '../../../src/core/match.js';
import { createEconomyService } from '../../../src/modules/economy/service.js';
import { createGamesService } from '../../../src/modules/games/service.js';
import type { LoggingService } from '../../../src/modules/logging/service.js';
import { createMatchesService, type MatchesService } from '../../../src/modules/matches/service.js';
import { createPermissionsService, dbCapabilitySource, dbRoleSource, type MemberFacts } from '../../../src/modules/permissions/service.js';
import { createRewardsService } from '../../../src/modules/rewards/service.js';
import { createSettingsService } from '../../../src/modules/settings/service.js';
import { FakeGateway } from '../../fakes/gateway.js';
import { testDb } from '../helpers.js';

export const CATEGORY = '500000000000000001';
export const RECRUIT = '500000000000000002';
export const MANAGER_ROLE = '600000000000000001';

export const OWNER: MemberFacts = { userId: '100000000000000001', roleIds: [], isGuildOwner: true, isAdministrator: false };
export const ORGANISER: MemberFacts = { userId: '100000000000000002', roleIds: ['600000000000000002'], isGuildOwner: false, isAdministrator: false };
export const STRANGER: MemberFacts = { userId: '100000000000000003', roleIds: [], isGuildOwner: false, isAdministrator: false };

/** Real-looking player ids, 18 digits; ascending with k. */
export const player = (k: number) => `3${String(k).padStart(17, '0')}`;

export interface LoggedEvent {
  name: string;
  fields: Record<string, unknown>;
  audit?: string;
}

export function recordingLogging(): LoggingService & { events: LoggedEvent[] } {
  const events: LoggedEvent[] = [];
  const record = (name: string, fields: Record<string, unknown>, audit?: string) => {
    events.push({ name, fields, audit });
    return Promise.resolve();
  };
  return {
    events,
    event: record,
    failure: record,
    ensureLogChannel: () => Promise.resolve('log-channel'),
    heartbeat: () => Promise.resolve(),
  };
}

export class TestClock implements Clock {
  constructor(private t = new Date('2026-09-19T12:00:00Z')) {}
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export interface Harness {
  matches: MatchesService;
  gateway: FakeGateway;
  logging: ReturnType<typeof recordingLogging>;
  clock: TestClock;
  gameId: number;
}

export async function harness(options: { autoSync?: boolean; nodeEnv?: string; rand?: (n: number) => number } = {}): Promise<Harness> {
  const db = testDb();
  const game = await db.game.create({ data: { slug: 'cs2', name: 'CS2', emoji: '🔫', defaultTeamSize: 5 } });
  await db.rewardRule.createMany({
    data: [
      { event: 'PARTICIPATION', gameId: null, amount: 25 },
      { event: 'WIN', gameId: null, amount: 100 },
      { event: 'MVP', gameId: null, amount: 50 },
      { event: 'DRAW', gameId: null, amount: 0 },
    ],
  });
  await db.roleCapability.create({ data: { roleId: ORGANISER.roleIds[0] as string, capability: 'ACTIVITY_CREATE' } });
  await db.roleCapability.create({ data: { roleId: MANAGER_ROLE, capability: 'MATCH_MANAGE_ANY' } });
  const settings = createSettingsService(db);
  await settings.update({ defaultVoiceCategoryId: CATEGORY, defaultRecruitChannelId: RECRUIT, autoMoveToVoice: true });

  const gateway = new FakeGateway();
  const logging = recordingLogging();
  const clock = new TestClock();
  const matches = createMatchesService({
    db,
    economy: createEconomyService(db),
    rewards: createRewardsService(db),
    games: createGamesService(db),
    permissions: createPermissionsService(dbCapabilitySource(db), dbRoleSource(db)),
    settings,
    logging,
    gateway,
    nodeEnv: options.nodeEnv ?? 'test',
    clock,
    autoSync: options.autoSync ?? false,
    rand: options.rand,
  });
  return { matches, gateway, logging, clock, gameId: game.id };
}

export async function newMatch(
  h: Harness,
  opts: { teamSize?: number; teamMode?: TeamModeName; actor?: MemberFacts } = {},
): Promise<number> {
  const { matchId } = await h.matches.create(opts.actor ?? ORGANISER, {
    gameId: h.gameId,
    teamSize: opts.teamSize ?? 5,
    teamMode: opts.teamMode ?? 'AUTO',
    title: null,
    recruitChannelId: RECRUIT,
  });
  return matchId;
}

/** Joins players `from..from+n-1` one after another. */
export async function fill(h: Harness, matchId: number, n: number, from = 1): Promise<string[]> {
  const ids: string[] = [];
  for (let k = from; k < from + n; k++) {
    await h.matches.join(matchId, player(k));
    ids.push(player(k));
  }
  return ids;
}

/** A match of 2×teamSize players already IN_PROGRESS (AUTO). Returns its id, version and teams. */
export async function startedMatch(h: Harness, opts: { teamSize?: number; from?: number } = {}) {
  const teamSize = opts.teamSize ?? 5;
  const id = await newMatch(h, { teamSize });
  await fill(h, id, teamSize * 2, opts.from ?? 1);
  const snap = await h.matches.get(id);
  expect(snap.status).toBe('IN_PROGRESS');
  const a = snap.participants.filter((p) => p.team === 'A').map((p) => p.userId);
  const b = snap.participants.filter((p) => p.team === 'B').map((p) => p.userId);
  return { id, version: snap.version, a, b };
}

/** participantCount = count(Participant) for every match; sum(ledger) = balance for every user. */
export async function expectInvariants(): Promise<void> {
  const db = testDb();
  const counts = await db.$queryRaw<{ id: number; participantCount: number; rows: bigint }[]>`
    SELECT m."id", m."participantCount", count(p."id") AS rows
    FROM "Match" m LEFT JOIN "Participant" p ON p."matchId" = m."id" GROUP BY m."id"`;
  for (const c of counts) expect({ match: c.id, count: c.participantCount }).toEqual({ match: c.id, count: Number(c.rows) });

  const drift = await db.$queryRaw<{ id: string; balance: number; ledger: bigint | null }[]>`
    SELECT u."id", u."balance", (SELECT sum(t."amount") FROM "KpTransaction" t WHERE t."userId" = u."id") AS ledger
    FROM "User" u`;
  for (const d of drift) expect({ user: d.id, balance: d.balance }).toEqual({ user: d.id, balance: Number(d.ledger ?? 0) });
}

export async function ledgerFor(matchId: number) {
  return testDb().kpTransaction.findMany({ where: { matchId }, orderBy: { id: 'asc' } });
}

export function codeOf(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null;
  return (result.reason as { code?: string }).code ?? String(result.reason);
}
