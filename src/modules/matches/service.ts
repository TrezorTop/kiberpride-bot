// Matches: recruitment to result (decisions 004, 008, 009). Every transition is one transaction
// that opens by locking the Match row with a status-guarded UPDATE (or SELECT … FOR UPDATE where
// the next step depends on the old status); Discord follows the database through `sync`
// (./sync.ts). Services check rights themselves — a forged custom_id cannot bypass them (008 §6).
import type { Clock } from '../../core/clock.js';
import { systemClock } from '../../core/clock.js';
import { DomainError, isDomainError, type DomainErrorCode } from '../../core/errors.js';
import {
  fakeUserId,
  fakeUserNumber,
  isFakeUserId,
  OPEN_STATUSES,
  type MatchSnapshot,
  type MatchStatusName,
  type RewardAmounts,
  type TeamModeName,
  type WinnerName,
} from '../../core/match.js';
import type { GuildGateway } from '../../core/ports.js';
import { Prisma, type Db, type Tx } from '../../db/client.js';
import { withTx } from '../../db/tx.js';
import type { EconomyService } from '../economy/service.js';
import type { GamesService } from '../games/service.js';
import type { LoggingService } from '../logging/service.js';
import { Capability, type MemberFacts, type PermissionsService } from '../permissions/service.js';
import { scaleRewards, type RewardsService } from '../rewards/service.js';
import type { SettingsService } from '../settings/service.js';
import { DEFAULT_TITLE, MAX_TEAM_SIZE, MAX_TITLE_LENGTH, MIN_TEAM_SIZE } from './constants.js';
import { payoutPlan, type PayoutLine } from './payout.js';
import { shuffle } from './shuffle.js';
import { createSyncer } from './sync.js';
import { createSyncQueue } from './syncQueue.js';
import { mayAddTestPlayers } from './testPlayers.js';

export type { MatchSnapshot, WinnerName };
export { DEFAULT_TITLE, MAX_TEAM_SIZE, MAX_TITLE_LENGTH, MIN_TEAM_SIZE };

export interface CreateMatchInput {
  gameId: number;
  /** 0 = the game's default format. */
  teamSize: number;
  teamMode: TeamModeName;
  title: string | null;
  recruitChannelId: string;
}

export interface JoinResult {
  participantCount: number;
  capacity: number;
  status: MatchStatusName;
}

export interface FinishInput {
  id: number;
  version: number;
  winner: WinnerName;
  /** null = «Без MVP» (decision 009 §3). */
  mvpUserId: string | null;
}

export interface MatchesService {
  create(actor: MemberFacts, input: CreateMatchInput): Promise<{ matchId: number }>;
  get(id: number): Promise<MatchSnapshot>;
  /** Non-terminal matches, newest first. */
  listOpen(limit: number): Promise<MatchSnapshot[]>;
  join(id: number, userId: string): Promise<JoinResult>;
  leave(id: number, userId: string): Promise<JoinResult>;
  removeParticipant(actor: MemberFacts, id: number, userId: string): Promise<void>;
  /** Team picker: the chosen players are team A, the rest team B. Returns the new version. */
  assignTeamA(actor: MemberFacts, id: number, userIds: readonly string[]): Promise<number>;
  confirmTeams(actor: MemberFacts, id: number, version: number): Promise<void>;
  /** ⭐ special match ×2, RECRUITING only (decision 009 §1). Returns the new version. */
  setSpecial(actor: MemberFacts, id: number, special: boolean): Promise<number>;
  finish(actor: MemberFacts, input: FinishInput): Promise<{ paid: PayoutLine[]; withheld: PayoutLine[] }>;
  cancel(actor: MemberFacts, id: number, version: number): Promise<void>;
  /** The recruit timeout (009 §5): cancels RECRUITING matches created before `cutoff`. */
  cancelStaleRecruitments(cutoff: Date): Promise<number[]>;
  /** A player left the Discord server (004 §5, 008 §9). Returns the affected match ids. */
  memberLeft(userId: string): Promise<number[]>;
  /** At startup: players of open matches who left while the bot was offline. */
  reconcileMembership(): Promise<string[]>;
  /** Fills the match to capacity − 1 with fake players (008 §10). Returns how many joined. */
  addTestPlayers(actor: MemberFacts, id: number): Promise<number>;
  /** Makes Discord match the database for one match, now (004 §6). */
  sync(id: number): Promise<void>;
  /** Schedules a coalesced sync (008 §5); resolves once a sync started after the call ends. */
  enqueueSync(id: number): Promise<void>;
  /** Ids needing a sync at startup: non-terminal, or syncedVersion < version. */
  needingSync(): Promise<number[]>;
  /** Deletes orphaned team channels (008 §7). Returns how many. */
  cleanupOrphans(): Promise<number>;
  /** Resolves when no sync is running or waiting. */
  idle(): Promise<void>;
}

export interface MatchesDeps {
  db: Db;
  economy: EconomyService;
  rewards: RewardsService;
  games: GamesService;
  permissions: PermissionsService;
  settings: SettingsService;
  logging: LoggingService;
  gateway: GuildGateway;
  nodeEnv: string;
  clock?: Clock;
  /** false: transitions do not schedule syncs (db tests drive `sync` by hand). Default true. */
  autoSync?: boolean;
  /** Random integer in [0, n) for the team split; crypto.randomInt by default. */
  rand?: (n: number) => number;
}

/** How a player appears in the log channel; fake players never become mentions. */
export function who(userId: string | null): string {
  if (userId === null) return 'система';
  return isFakeUserId(userId) ? `🧪 тестовый игрок ${fakeUserNumber(userId)}` : `<@${userId}>`;
}

const status = (s: MatchStatusName) => Prisma.sql`${s}::"MatchStatus"`;
const statusList = (list: readonly MatchStatusName[]) => Prisma.join(list.map(status));

export function createMatchesService(deps: MatchesDeps): MatchesService {
  const { db, economy, permissions, logging, gateway } = deps;
  const clock = deps.clock ?? systemClock;
  const autoSync = deps.autoSync ?? true;

  const syncer = createSyncer({ db, gateway, permissions, settings: deps.settings, logging, clock, load });
  const queue = createSyncQueue(syncer.sync, (id, err) => {
    void logging.failure(
      'match.sync_failed',
      { matchId: id, err },
      `⚠️ Матч #${id}: не удалось обновить сообщение или каналы в Discord — повторю при следующем изменении или перезапуске. Подробности в логе процесса.`,
    );
  });
  const schedule = (id: number) => {
    if (autoSync) void queue.enqueue(id);
  };

  async function basic(id: number) {
    const m = await db.match.findUnique({ where: { id }, select: { id: true, createdById: true, gameId: true, status: true } });
    if (!m) throw new DomainError('NOT_FOUND', `match ${id}`);
    return m;
  }

  async function requireManage(actor: MemberFacts, match: { createdById: string; id: number }) {
    if (!(await permissions.canManageMatch(actor, match))) {
      throw new DomainError('NOT_ALLOWED', `user ${actor.userId} on match ${match.id}`);
    }
  }

  /** Why a guarded UPDATE matched no row, as the error the organiser should see. */
  async function refusal(tx: Tx, id: number, expected: MatchStatusName, version: number | null): Promise<DomainError> {
    const m = await tx.match.findUnique({ where: { id }, select: { status: true, version: true } });
    const code: DomainErrorCode = !m
      ? 'NOT_FOUND'
      : m.status === 'FINISHED'
        ? 'MATCH_ALREADY_FINISHED'
        : m.status === 'CANCELLED'
          ? 'MATCH_CANCELLED'
          : m.status !== expected
            ? expected === 'IN_PROGRESS' && (m.status === 'RECRUITING' || m.status === 'TEAMS_PENDING')
              ? 'TEAMS_NOT_READY'
              : 'STALE_PANEL'
            : version !== null && m.version !== version
              ? 'STALE_PANEL'
              : 'TEAMS_NOT_READY';
    return new DomainError(code, `match ${id}: expected ${expected}${version === null ? '' : ` v${version}`}, found ${m?.status} v${m?.version}`);
  }

  /**
   * Takes a player off the roster of a RECRUITING or TEAMS_PENDING match (leave, removal, a
   * player leaving the server). From TEAMS_PENDING the match reopens: teams cleared,
   * announcedStatus reset so the next close announces again (004 §2, 008 §8).
   */
  async function removeTx(
    tx: Tx,
    id: number,
    userId: string,
    allowed: readonly MatchStatusName[],
    notThere: DomainErrorCode,
  ): Promise<{ from: MatchStatusName; version: number }> {
    const locked = await tx.$queryRaw<{ status: MatchStatusName }[]>`
      SELECT "status" FROM "Match" WHERE "id" = ${id} FOR UPDATE`;
    const from = locked[0]?.status;
    if (!from) throw new DomainError('NOT_FOUND', `match ${id}`);
    if (!allowed.includes(from)) {
      const code: DomainErrorCode =
        from === 'FINISHED'
          ? 'MATCH_ALREADY_FINISHED'
          : from === 'CANCELLED'
            ? 'MATCH_CANCELLED'
            : from === 'IN_PROGRESS'
              ? 'MATCH_STARTED'
              : 'ROSTER_LOCKED';
      throw new DomainError(code, `match ${id} is ${from}`);
    }
    const deleted = await tx.$queryRaw<{ id: number }[]>`
      DELETE FROM "Participant" WHERE "matchId" = ${id} AND "userId" = ${userId} RETURNING "id"`;
    if (deleted.length === 0) throw new DomainError(notThere, `user ${userId} not in match ${id}`);

    const reopen = from === 'TEAMS_PENDING';
    const updated = await tx.$queryRaw<{ version: number }[]>`
      UPDATE "Match" SET
        "participantCount" = "participantCount" - 1,
        "version" = "version" + 1,
        "status" = 'RECRUITING'::"MatchStatus",
        "closedAt" = NULL,
        "announcedStatus" = CASE WHEN ${reopen} THEN NULL ELSE "announcedStatus" END
      WHERE "id" = ${id} AND "status" = ${status(from)}
      RETURNING "version"`;
    if (!updated[0]) throw new Error(`match ${id}: row changed under a FOR UPDATE lock`);
    if (reopen) await tx.participant.updateMany({ where: { matchId: id }, data: { team: null } });
    return { from, version: updated[0].version };
  }

  async function joinTx(id: number, userId: string): Promise<JoinResult & { teams?: { a: string[]; b: string[] } }> {
    const now = clock.now();
    return withTx(db, async (tx) => {
      await tx.$executeRaw`INSERT INTO "User" ("id") VALUES (${userId}) ON CONFLICT ("id") DO NOTHING`;

      // 009 §2: a player in a started match cannot sign up anywhere else until it ends.
      const busy = await tx.$queryRaw<{ id: number }[]>`
        SELECT m."id" FROM "Participant" p JOIN "Match" m ON m."id" = p."matchId"
        WHERE p."userId" = ${userId} AND p."leftServerAt" IS NULL AND m."status" = 'IN_PROGRESS'
        LIMIT 1`;
      if (busy[0]) throw new DomainError('BUSY_IN_MATCH', `user ${userId} plays match ${busy[0].id}`);

      // 003 §10: the row lock serialises every roster change of this match. The last seat
      // closes the recruitment in the same statement: AUTO starts, MANUAL waits for the picker.
      const rows = await tx.$queryRaw<{ status: MatchStatusName; participantCount: number; capacity: number; teamSize: number }[]>`
        UPDATE "Match" SET
          "participantCount" = "participantCount" + 1,
          "version" = "version" + 1,
          "status" = CASE
            WHEN "participantCount" + 1 < "capacity" THEN "status"
            WHEN "teamMode" = 'AUTO' THEN 'IN_PROGRESS'::"MatchStatus"
            ELSE 'TEAMS_PENDING'::"MatchStatus" END,
          "closedAt" = CASE WHEN "participantCount" + 1 = "capacity" THEN ${now} ELSE "closedAt" END,
          "startedAt" = CASE WHEN "participantCount" + 1 = "capacity" AND "teamMode" = 'AUTO' THEN ${now} ELSE "startedAt" END
        WHERE "id" = ${id} AND "status" = 'RECRUITING' AND "participantCount" < "capacity"
        RETURNING "status", "participantCount", "capacity", "teamSize"`;
      const updated = rows[0];
      if (!updated) {
        const already = await tx.participant.findUnique({ where: { matchId_userId: { matchId: id, userId } }, select: { id: true } });
        if (already) throw new DomainError('ALREADY_JOINED', `user ${userId} match ${id}`);
        const exists = await tx.match.findUnique({ where: { id }, select: { id: true } });
        throw new DomainError(exists ? 'MATCH_CLOSED' : 'NOT_FOUND', `match ${id}`);
      }

      // The unique (matchId, userId) index is the guard; a conflict rolls the counter back.
      const inserted = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO "Participant" ("matchId", "userId", "joinedAt") VALUES (${id}, ${userId}, ${now})
        ON CONFLICT ("matchId", "userId") DO NOTHING RETURNING "id"`;
      if (!inserted[0]) throw new DomainError('ALREADY_JOINED', `user ${userId} match ${id}`);

      const result: JoinResult = { status: updated.status, participantCount: updated.participantCount, capacity: updated.capacity };
      if (updated.status !== 'IN_PROGRESS') return result;

      // AUTO split in the same transaction (004 §2).
      const everyone = await tx.participant.findMany({
        where: { matchId: id },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        select: { userId: true },
      });
      if (everyone.length !== updated.capacity) {
        throw new Error(`match ${id}: ${everyone.length} participants for capacity ${updated.capacity}`);
      }
      const mixed = shuffle(
        everyone.map((p) => p.userId),
        deps.rand,
      );
      const a = mixed.slice(0, updated.teamSize);
      const b = mixed.slice(updated.teamSize);
      await tx.participant.updateMany({ where: { matchId: id, userId: { in: a } }, data: { team: 'A' } });
      await tx.participant.updateMany({ where: { matchId: id, userId: { in: b } }, data: { team: 'B' } });
      return { ...result, teams: { a, b } };
    });
  }

  async function afterJoin(id: number, userId: string, result: Awaited<ReturnType<typeof joinTx>>) {
    await logging.event('match.join', { matchId: id, userId, count: result.participantCount, capacity: result.capacity });
    if (result.status === 'IN_PROGRESS') {
      await logging.event(
        'match.started',
        { matchId: id, teamA: result.teams?.a, teamB: result.teams?.b },
        `🎮 Матч #${id}: набор закрыт, команды распределены случайно. 🔵 ${result.teams?.a.map(who).join(', ')} · 🔴 ${result.teams?.b.map(who).join(', ')}`,
      );
    } else if (result.status === 'TEAMS_PENDING') {
      await logging.event('match.teams_pending', { matchId: id }, `🔧 Матч #${id}: набор закрыт, организатор распределяет команды.`);
    }
  }

  async function cancelTransition(opts: {
    id: number;
    actorId: string | null;
    from: readonly MatchStatusName[];
    version: number | null;
    createdBefore: Date | null;
  }): Promise<MatchStatusName> {
    const { id, actorId, from, version, createdBefore } = opts;
    const now = clock.now();
    const previous = await withTx(db, async (tx) => {
      const locked = await tx.$queryRaw<{ status: MatchStatusName }[]>`
        SELECT "status" FROM "Match" WHERE "id" = ${id} FOR UPDATE`;
      const rows = await tx.$queryRaw<{ id: number }[]>`
        UPDATE "Match" SET "status" = 'CANCELLED'::"MatchStatus", "version" = "version" + 1,
          "endedAt" = ${now}, "endedById" = ${actorId}
        WHERE "id" = ${id} AND "status" IN (${statusList(from)})
          ${version === null ? Prisma.empty : Prisma.sql`AND "version" = ${version}`}
          ${createdBefore === null ? Prisma.empty : Prisma.sql`AND "createdAt" < ${createdBefore}`}
        RETURNING "id"`;
      if (!rows[0]) throw await refusal(tx, id, locked[0]?.status ?? 'RECRUITING', version);
      return locked[0]?.status ?? 'RECRUITING';
    });
    const why = actorId === null ? 'набор закрыт по времени' : `отменил ${who(actorId)}`;
    await logging.event('match.cancelled', { matchId: id, from: previous, actorId, timeout: actorId === null }, `🚫 Матч #${id} отменён: ${why}. KP Coin не начислялись.`);
    schedule(id);
    return previous;
  }

  /** One player gone from the server, one match: 004 §5 by the match's status. */
  async function departOne(matchId: number, userId: string): Promise<'removed' | 'reopened' | 'marked' | 'none'> {
    const now = clock.now();
    return withTx(db, async (tx) => {
      const locked = await tx.$queryRaw<{ status: MatchStatusName }[]>`
        SELECT "status" FROM "Match" WHERE "id" = ${matchId} FOR UPDATE`;
      const current = locked[0]?.status;
      if (current === 'RECRUITING' || current === 'TEAMS_PENDING') {
        const { from } = await removeTx(tx, matchId, userId, ['RECRUITING', 'TEAMS_PENDING'], 'NOT_IN_MATCH');
        return from === 'TEAMS_PENDING' ? 'reopened' : 'removed';
      }
      if (current !== 'IN_PROGRESS') return 'none';
      // 008 §9: the payout set changed, so the version moves and an open finish panel goes stale.
      const marked = await tx.$queryRaw<{ id: number }[]>`
        UPDATE "Participant" SET "leftServerAt" = ${now}
        WHERE "matchId" = ${matchId} AND "userId" = ${userId} AND "leftServerAt" IS NULL RETURNING "id"`;
      if (!marked[0]) return 'none';
      await tx.$executeRaw`UPDATE "Match" SET "version" = "version" + 1 WHERE "id" = ${matchId} AND "status" = 'IN_PROGRESS'`;
      return 'marked';
    });
  }

  async function load(client: Tx, id: number): Promise<MatchSnapshot | null> {
    const m = await client.match.findUnique({
      where: { id },
      include: {
        game: { select: { id: true, name: true, emoji: true } },
        participants: { orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] },
      },
    });
    return m ? toSnapshot(m) : null;
  }

  const service: MatchesService = {
    async create(actor, input) {
      if (!(await permissions.can(actor, Capability.ACTIVITY_CREATE))) throw new DomainError('NOT_ALLOWED', 'create');
      const game = await deps.games.get(input.gameId);
      if (!game?.enabled) throw new DomainError('NOT_FOUND', `game ${input.gameId}`);
      const settings = await deps.settings.get();
      const categoryId = settings.defaultVoiceCategoryId;
      if (!categoryId) throw new DomainError('SETUP_REQUIRED', 'no voice category');
      const teamSize = input.teamSize === 0 ? game.defaultTeamSize : input.teamSize;
      if (!Number.isInteger(teamSize) || teamSize < MIN_TEAM_SIZE || teamSize > MAX_TEAM_SIZE) {
        throw new Error(`create: team size ${teamSize} outside ${MIN_TEAM_SIZE}..${MAX_TEAM_SIZE}`);
      }
      const missing = [
        ...(await gateway.checkRecruitChannel(input.recruitChannelId)).map((p) => `recruit:${p}`),
        ...(await gateway.checkVoiceCategory(categoryId)).map((p) => `voice:${p}`),
      ];
      if (missing.length > 0) throw new DomainError('BOT_MISSING_PERMISSIONS', missing.join(','), { missing });

      const rewards = await deps.rewards.resolveFor(game.id);
      const title = input.title?.trim().slice(0, MAX_TITLE_LENGTH) || DEFAULT_TITLE;
      const row = await db.match.create({
        data: {
          gameId: game.id,
          title,
          teamSize,
          capacity: teamSize * 2,
          teamMode: input.teamMode,
          createdById: actor.userId,
          recruitChannelId: input.recruitChannelId,
          voiceCategoryId: categoryId,
          rewards: { ...rewards },
          createdAt: clock.now(),
        },
        select: { id: true },
      });
      await logging.event(
        'match.created',
        { matchId: row.id, gameId: game.id, teamSize, teamMode: input.teamMode, actorId: actor.userId, rewards },
        `➕ Матч #${row.id} создан: ${game.name} ${teamSize}×${teamSize}, ${input.teamMode === 'AUTO' ? 'команды случайно' : 'команды выбирает организатор'}, организатор ${who(actor.userId)}. Награды: участие ${rewards.participation}, победа ${rewards.win}, MVP ${rewards.mvp}, ничья ${rewards.draw} KP Coin.`,
      );
      if (autoSync) await queue.enqueue(row.id); // create is the one caller that waits (008 §5)
      return { matchId: row.id };
    },

    async get(id) {
      const snap = await load(db, id);
      if (!snap) throw new DomainError('NOT_FOUND', `match ${id}`);
      return snap;
    },

    async listOpen(limit) {
      const rows = await db.match.findMany({
        where: { status: { in: [...OPEN_STATUSES] } },
        orderBy: { id: 'desc' },
        take: limit,
        include: { game: { select: { id: true, name: true, emoji: true } }, participants: { orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] } },
      });
      return rows.map(toSnapshot);
    },

    async join(id, userId) {
      const result = await joinTx(id, userId);
      await afterJoin(id, userId, result);
      schedule(id);
      return { status: result.status, participantCount: result.participantCount, capacity: result.capacity };
    },

    async leave(id, userId) {
      const result = await withTx(db, async (tx) => {
        await removeTx(tx, id, userId, ['RECRUITING'], 'NOT_IN_MATCH');
        return tx.match.findUniqueOrThrow({ where: { id }, select: { status: true, participantCount: true, capacity: true } });
      });
      await logging.event('match.leave', { matchId: id, userId, count: result.participantCount });
      schedule(id);
      return result;
    },

    async removeParticipant(actor, id, userId) {
      await requireManage(actor, await basic(id));
      const { from } = await withTx(db, (tx) => removeTx(tx, id, userId, ['RECRUITING', 'TEAMS_PENDING'], 'NOT_A_PARTICIPANT'));
      await logging.event(
        'match.participant_removed',
        { matchId: id, userId, actorId: actor.userId, reopened: from === 'TEAMS_PENDING' },
        `➖ Матч #${id}: ${who(actor.userId)} убрал ${who(userId)} из состава${from === 'TEAMS_PENDING' ? ' — набор снова открыт' : ''}.`,
      );
      schedule(id);
    },

    async assignTeamA(actor, id, userIds) {
      await requireManage(actor, await basic(id));
      const chosen = [...new Set(userIds)];
      const version = await withTx(db, async (tx) => {
        const rows = await tx.$queryRaw<{ version: number; teamSize: number }[]>`
          UPDATE "Match" SET "version" = "version" + 1
          WHERE "id" = ${id} AND "status" = 'TEAMS_PENDING' RETURNING "version", "teamSize"`;
        const m = rows[0];
        if (!m) throw await refusal(tx, id, 'TEAMS_PENDING', null);
        if (chosen.length !== m.teamSize) throw new DomainError('TEAMS_NOT_READY', `picked ${chosen.length} of ${m.teamSize}`);
        const roster = await tx.participant.findMany({ where: { matchId: id }, select: { userId: true } });
        const onRoster = new Set(roster.map((p) => p.userId));
        if (chosen.some((u) => !onRoster.has(u))) throw new DomainError('NOT_A_PARTICIPANT', `match ${id}`);
        await tx.participant.updateMany({ where: { matchId: id, userId: { in: chosen } }, data: { team: 'A' } });
        await tx.participant.updateMany({ where: { matchId: id, userId: { notIn: chosen } }, data: { team: 'B' } });
        return m.version;
      });
      await logging.event(
        'match.teams_assigned',
        { matchId: id, teamA: chosen, actorId: actor.userId },
        `🔧 Матч #${id}: ${who(actor.userId)} выбрал 🔵 Команду A: ${chosen.map(who).join(', ')}.`,
      );
      schedule(id);
      return version;
    },

    async confirmTeams(actor, id, version) {
      await requireManage(actor, await basic(id));
      const now = clock.now();
      await withTx(db, async (tx) => {
        const rows = await tx.$queryRaw<{ id: number }[]>`
          UPDATE "Match" m SET "status" = 'IN_PROGRESS'::"MatchStatus", "version" = m."version" + 1, "startedAt" = ${now}
          WHERE m."id" = ${id} AND m."status" = 'TEAMS_PENDING' AND m."version" = ${version}
            AND (SELECT count(*) FROM "Participant" p WHERE p."matchId" = m."id" AND p."team" = 'A') = m."teamSize"
            AND (SELECT count(*) FROM "Participant" p WHERE p."matchId" = m."id" AND p."team" = 'B') = m."teamSize"
          RETURNING m."id"`;
        if (!rows[0]) throw await refusal(tx, id, 'TEAMS_PENDING', version);
      });
      await logging.event('match.started', { matchId: id, actorId: actor.userId }, `🎮 Матч #${id}: ${who(actor.userId)} подтвердил команды, матч начался.`);
      schedule(id);
    },

    async setSpecial(actor, id, special) {
      const m = await basic(id);
      await requireManage(actor, m);
      // 009 §1: recomputed from the settings, ×2 or ×1 — never halved, so odd amounts stay exact.
      const rewards = scaleRewards(await deps.rewards.resolveFor(m.gameId), special ? 2 : 1);
      const version = await withTx(db, async (tx) => {
        const rows = await tx.$queryRaw<{ version: number }[]>`
          UPDATE "Match" SET "special" = ${special}, "rewards" = ${JSON.stringify(rewards)}::jsonb, "version" = "version" + 1
          WHERE "id" = ${id} AND "status" = 'RECRUITING' AND "special" <> ${special} RETURNING "version"`;
        if (rows[0]) return rows[0].version;
        const now = await tx.match.findUnique({ where: { id }, select: { status: true, version: true } });
        if (now?.status !== 'RECRUITING') throw new DomainError('SPECIAL_ONLY_RECRUITING', `match ${id} is ${now?.status}`);
        return null; // already in the asked state: nothing to do
      });
      if (version === null) return (await basicVersion(id)) ?? 0;
      await logging.event(
        'match.special',
        { matchId: id, special, rewards, actorId: actor.userId },
        special
          ? `⭐ Матч #${id} стал особым — ${who(actor.userId)} включил награды ×2 (участие ${rewards.participation}, победа ${rewards.win}, MVP ${rewards.mvp}, ничья ${rewards.draw} KP Coin).`
          : `⭐ Матч #${id} снова обычный — ${who(actor.userId)} выключил награды ×2.`,
      );
      schedule(id);
      return version;
    },

    async finish(actor, input) {
      const { id, version, winner, mvpUserId } = input;
      await requireManage(actor, await basic(id));
      const now = clock.now();
      const { lines } = await withTx(db, async (tx) => {
        const rows = await tx.$queryRaw<{ id: number }[]>`
          UPDATE "Match" SET "status" = 'FINISHED'::"MatchStatus", "version" = "version" + 1,
            "winner" = ${winner}::"Winner", "mvpUserId" = ${mvpUserId}, "endedAt" = ${now}, "endedById" = ${actor.userId}
          WHERE "id" = ${id} AND "status" = 'IN_PROGRESS' AND "version" = ${version}
          RETURNING "id"`;
        if (!rows[0]) throw await refusal(tx, id, 'IN_PROGRESS', version);

        const snap = await load(tx, id);
        if (!snap) throw new Error(`match ${id} vanished inside its own transaction`);
        if (mvpUserId !== null && !snap.participants.some((p) => p.userId === mvpUserId && p.team !== null)) {
          throw new DomainError('NOT_A_PARTICIPANT', `mvp ${mvpUserId} did not play match ${id}`);
        }
        // Ascending userId: overlapping finishes lock User rows in one order (decision 007).
        const plan = payoutPlan(snap);
        for (const line of plan) {
          if (line.withheld) continue;
          await economy.move(
            {
              userId: line.userId,
              amount: line.amount,
              kind: line.kind,
              reference: line.reference,
              description: line.description,
              matchId: id,
              actorId: actor.userId,
            },
            tx,
          );
        }
        return { lines: plan };
      });

      const paid = lines.filter((l) => !l.withheld);
      const withheld = lines.filter((l) => l.withheld);
      for (const line of paid) {
        await logging.event('match.reward_paid', { matchId: id, userId: line.userId, amount: line.amount, reference: line.reference });
      }
      const total = paid.reduce((s, l) => s + l.amount, 0);
      const winnerText = winner === 'DRAW' ? 'ничья' : winner === 'A' ? 'победа 🔵 A' : 'победа 🔴 B';
      await logging.event(
        'match.finished',
        { matchId: id, winner, mvpUserId, actorId: actor.userId, paidLines: paid.length, paidTotal: total, withheldLines: withheld.length },
        `🏁 Матч #${id} завершён (${who(actor.userId)}): ${winnerText}, MVP ${mvpUserId ? who(mvpUserId) : 'не выбран'}. Выплачено ${total} KP Coin (${paid.length} начислений).`,
      );
      for (const line of withheld) {
        await logging.event(
          'match.reward_withheld',
          { matchId: id, userId: line.userId, amount: line.amount, reference: line.reference },
          `⏸️ Матч #${id}: ${line.amount} KP Coin за «${line.description}» удержано у ${who(line.userId)} — игрок покинул сервер. Ссылка для ручной выплаты: \`${line.reference}\``,
        );
      }
      schedule(id);
      return { paid, withheld };
    },

    async cancel(actor, id, version) {
      await requireManage(actor, await basic(id));
      await cancelTransition({ id, actorId: actor.userId, from: OPEN_STATUSES, version, createdBefore: null });
    },

    async cancelStaleRecruitments(cutoff) {
      const stale = await db.match.findMany({
        where: { status: 'RECRUITING', createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const cancelled: number[] = [];
      for (const { id } of stale) {
        try {
          await cancelTransition({ id, actorId: null, from: ['RECRUITING'], version: null, createdBefore: cutoff });
          cancelled.push(id);
        } catch (err) {
          if (!isDomainError(err)) throw err; // filled or cancelled meanwhile: nothing to do
        }
      }
      return cancelled;
    },

    async memberLeft(userId) {
      const rows = await db.participant.findMany({
        where: { userId, leftServerAt: null, match: { status: { in: [...OPEN_STATUSES] } } },
        select: { matchId: true },
        orderBy: { matchId: 'asc' },
      });
      const affected: number[] = [];
      for (const { matchId } of rows) {
        let outcome: Awaited<ReturnType<typeof departOne>>;
        try {
          outcome = await departOne(matchId, userId);
        } catch (err) {
          if (isDomainError(err)) continue; // the match moved on meanwhile
          throw err;
        }
        if (outcome === 'none') continue;
        affected.push(matchId);
        const text = {
          removed: 'убран из набора',
          reopened: 'убран из состава — набор снова открыт',
          marked: 'остаётся в составе, его награды будут удержаны',
        }[outcome];
        await logging.event('match.member_left', { matchId, userId, outcome }, `🚪 ${who(userId)} покинул сервер — матч #${matchId}: ${text}.`);
        schedule(matchId);
      }
      return affected;
    },

    async reconcileMembership() {
      const rows = await db.participant.findMany({
        where: { leftServerAt: null, match: { status: { in: [...OPEN_STATUSES] } } },
        select: { userId: true },
        distinct: ['userId'],
      });
      const real = rows.map((r) => r.userId).filter((id) => !isFakeUserId(id));
      if (real.length === 0) return [];
      const present = await gateway.presentMembers(real);
      const gone = real.filter((id) => !present.has(id));
      for (const userId of gone) await service.memberLeft(userId);
      return gone;
    },

    async addTestPlayers(actor, id) {
      if (!mayAddTestPlayers(actor, deps.nodeEnv)) throw new DomainError('NOT_ALLOWED', 'test players');
      const m = await db.match.findUnique({ where: { id }, select: { status: true, participantCount: true, capacity: true } });
      if (!m) throw new DomainError('NOT_FOUND', `match ${id}`);
      if (m.status !== 'RECRUITING') throw new DomainError('MATCH_CLOSED', `match ${id}`);
      const target = m.capacity - 1; // the owner's own press closes the roster
      let count = m.participantCount;
      let added = 0;
      // Through the real join path (008 §10); a fake player busy in another test match is skipped.
      for (let k = 1; count < target && k <= 500; k++) {
        try {
          const result = await joinTx(id, fakeUserId(k));
          count = result.participantCount;
          added++;
        } catch (err) {
          if (isDomainError(err) && (err.code === 'ALREADY_JOINED' || err.code === 'BUSY_IN_MATCH')) continue;
          if (isDomainError(err) && err.code === 'MATCH_CLOSED') break;
          throw err;
        }
      }
      await logging.event('match.test_players', { matchId: id, added, actorId: actor.userId }, `🧪 Матч #${id}: добавлено тестовых игроков — ${added}.`);
      schedule(id);
      return added;
    },

    sync: syncer.sync,
    enqueueSync: (id) => queue.enqueue(id),

    async needingSync() {
      const rows = await db.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Match"
        WHERE "status" IN (${statusList(OPEN_STATUSES)}) OR "syncedVersion" < "version"
        ORDER BY "id"`;
      return rows.map((r) => r.id);
    },

    cleanupOrphans: syncer.cleanupOrphans,
    idle: () => queue.idle(),
  };
  return service;

  async function basicVersion(id: number): Promise<number | null> {
    return (await db.match.findUnique({ where: { id }, select: { version: true } }))?.version ?? null;
  }
}

type MatchRow = Prisma.MatchGetPayload<{
  include: { game: { select: { id: true; name: true; emoji: true } }; participants: true };
}>;

function toSnapshot(m: MatchRow): MatchSnapshot {
  return {
    id: m.id,
    game: m.game,
    title: m.title,
    teamSize: m.teamSize,
    capacity: m.capacity,
    teamMode: m.teamMode,
    status: m.status,
    version: m.version,
    syncedVersion: m.syncedVersion,
    announcedStatus: m.announcedStatus,
    participantCount: m.participantCount,
    createdById: m.createdById,
    recruitChannelId: m.recruitChannelId,
    recruitMessageId: m.recruitMessageId,
    voiceCategoryId: m.voiceCategoryId,
    voiceChannelAId: m.voiceChannelAId,
    voiceChannelBId: m.voiceChannelBId,
    rewards: parseRewards(m.rewards),
    special: m.special,
    winner: m.winner,
    mvpUserId: m.mvpUserId,
    createdAt: m.createdAt,
    endedAt: m.endedAt,
    endedById: m.endedById,
    participants: m.participants.map((p) => ({ userId: p.userId, team: p.team, joinedAt: p.joinedAt, leftServerAt: p.leftServerAt })),
  };
}

function parseRewards(json: unknown): RewardAmounts {
  const o = (json ?? {}) as Record<string, unknown>;
  const n = (k: string) => {
    const v = o[k];
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
  };
  return { participation: n('participation'), win: n('win'), mvp: n('mvp'), draw: n('draw') };
}
