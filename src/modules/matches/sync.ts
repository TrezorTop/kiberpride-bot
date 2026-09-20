// `sync(id)`: Discord follows the database (decisions 004 §6, 008 §5, §7, §8). Idempotent and
// convergent from any crash point: it never bumps `version`, records the version it read with
// `syncedVersion < v`, and saves each channel id the moment Discord returns it, guarded by the
// id it replaced. Runs through the coalescing queue (./syncQueue.ts), never inside a transaction.
import type { Clock } from '../../core/clock.js';
import {
  isFakeUserId,
  isTerminal,
  OPEN_STATUSES,
  VOICE_CHANNEL_NAME_RE,
  voiceChannelName,
  type MatchSnapshot,
  type MatchStatusName,
  type TeamName,
} from '../../core/match.js';
import type { GuildGateway } from '../../core/ports.js';
import { Prisma, type Db, type Tx } from '../../db/client.js';
import type { LoggingService } from '../logging/service.js';
import { Capability, type PermissionsService } from '../permissions/service.js';
import type { SettingsService } from '../settings/service.js';
import type { FailureDedupe } from './syncFailures.js';

/** A match ended this long ago still makes its category «managed» for orphan cleanup (008 §7). */
const ORPHAN_WINDOW_MS = 7 * 24 * 60 * 60_000;
const ANNOUNCED: readonly MatchStatusName[] = ['TEAMS_PENDING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED'];
const TEAMS: readonly TeamName[] = ['A', 'B'];
const COLUMN = { A: Prisma.raw('"voiceChannelAId"'), B: Prisma.raw('"voiceChannelBId"') } as const;

export interface SyncDeps {
  db: Db;
  gateway: GuildGateway;
  permissions: PermissionsService;
  settings: SettingsService;
  logging: LoggingService;
  clock: Clock;
  /** Shared with the sync-retry reporter: one log-channel line per (match, version). */
  failures: FailureDedupe;
  load(client: Tx, id: number): Promise<MatchSnapshot | null>;
}

export function createSyncer(deps: SyncDeps) {
  const { db, gateway, logging } = deps;

  const channelOf = (snap: MatchSnapshot, team: TeamName) => (team === 'A' ? snap.voiceChannelAId : snap.voiceChannelBId);

  async function saveChannel(id: number, team: TeamName, previous: string | null, next: string | null): Promise<void> {
    const col = COLUMN[team];
    await db.$executeRaw`
      UPDATE "Match" SET ${col} = ${next}
      WHERE "id" = ${id} AND (${col} IS NULL OR ${col} = ${previous})`;
  }

  /** Real, still-present players of a team: the only user ids that may reach the gateway. */
  const teamMembers = (snap: MatchSnapshot, team: TeamName) =>
    snap.participants.filter((p) => p.team === team && p.leftServerAt === null && !isFakeUserId(p.userId)).map((p) => p.userId);

  async function syncVoice(snap: MatchSnapshot): Promise<Record<TeamName, string | null>> {
    const result: Record<TeamName, string | null> = { A: snap.voiceChannelAId, B: snap.voiceChannelBId };
    const wanted = snap.status === 'TEAMS_PENDING' || snap.status === 'IN_PROGRESS';

    if (!wanted) {
      for (const team of TEAMS) {
        const current = channelOf(snap, team);
        if (!current) continue;
        await gateway.deleteChannel(current);
        await db.$executeRaw`UPDATE "Match" SET ${COLUMN[team]} = NULL WHERE "id" = ${snap.id} AND ${COLUMN[team]} = ${current}`;
        result[team] = null;
      }
      return result;
    }

    // 008 §7: the organisers see both channels from TEAMS_PENDING; the team joins at IN_PROGRESS.
    const roles = await deps.permissions.rolesWith(Capability.MATCH_MANAGE_ANY);
    for (const team of TEAMS) {
      const current = channelOf(snap, team);
      const members = snap.status === 'IN_PROGRESS' ? teamMembers(snap, team) : [];
      const allowUserIds = [...new Set([snap.createdById, ...members])].filter((u) => !isFakeUserId(u));
      const id = await gateway.ensureVoiceChannel({
        categoryId: snap.voiceCategoryId,
        name: voiceChannelName(team, snap.id),
        currentId: current,
        allowUserIds,
        allowRoleIds: roles,
      });
      if (id !== current) await saveChannel(snap.id, team, current, id);
      result[team] = id;
    }
    return result;
  }

  async function announce(snap: MatchSnapshot): Promise<void> {
    if (!ANNOUNCED.includes(snap.status) || snap.announcedStatus === snap.status) return;
    if (snap.status === 'IN_PROGRESS' && (await deps.settings.get()).autoMoveToVoice) {
      for (const team of TEAMS) {
        const channel = channelOf(snap, team);
        if (channel) await gateway.moveMembers(teamMembers(snap, team), channel);
      }
    }
    await gateway.announce(snap.recruitChannelId, snap, snap.status);
    // Guarded by the status: a reopen meanwhile (announcedStatus reset to NULL) is not undone.
    // A crash between the post and this line repeats one announcement — accepted (008 §8).
    await db.$executeRaw`
      UPDATE "Match" SET "announcedStatus" = ${snap.status}::"MatchStatus"
      WHERE "id" = ${snap.id} AND "status" = ${snap.status}::"MatchStatus"`;
  }

  /**
   * The recruit channel is the one id `sync` cannot re-create: it is NOT NULL and the match was
   * created in it. When it does not resolve here — deleted, left behind in the guild the bot
   * served before (2026-09-20), or simply invisible to the bot because someone took View away —
   * there is nowhere to post and nothing to converge, so this pass stops before any Discord work
   * and says so once per (match, version).
   *
   * It does NOT stamp `syncedVersion` (review 2026-09-20): `NotFound` covers a 50001 on a channel
   * in the served guild too, and that is repairable — give the bot View back and the match must
   * catch up by itself. Stamping would take the match out of `unsynced()` and the minute job
   * would never look at it again, freezing the message until a restart.
   *
   * Only «NotFound» gives up: a missing PERMISSION must keep failing loudly (architect's ruling).
   */
  async function recruitChannelUnreachable(snap: MatchSnapshot): Promise<boolean> {
    if (!(await gateway.checkRecruitChannel(snap.recruitChannelId)).includes('NotFound')) return false;
    if (deps.failures.firstFor(snap.id, snap.version)) {
      await logging.failure(
        'match.recruit_channel_unreachable',
        { matchId: snap.id, channelId: snap.recruitChannelId, version: snap.version, status: snap.status },
        isTerminal(snap.status)
          ? undefined // nothing for anyone to do about a match that is already over
          : `⚠️ Матч #${snap.id}: бот не видит канал набора — верни боту доступ к каналу. Если канала больше нет, отмени матч в «/игры».`,
      );
    }
    return true;
  }

  async function sync(id: number): Promise<void> {
    const read = await deps.load(db, id);
    if (!read) return;
    const version = read.version;

    // Left unsynced on purpose: the retry job keeps trying, so access given back repairs itself.
    if (await recruitChannelUnreachable(read)) return;

    const channels = await syncVoice(read);
    const snap: MatchSnapshot = { ...read, voiceChannelAId: channels.A, voiceChannelBId: channels.B };

    const messageId = await gateway.renderMatchMessage(snap, snap.recruitChannelId, snap.recruitMessageId);
    if (messageId !== snap.recruitMessageId) {
      await db.$executeRaw`
        UPDATE "Match" SET "recruitMessageId" = ${messageId}
        WHERE "id" = ${id} AND ("recruitMessageId" IS NULL OR "recruitMessageId" = ${snap.recruitMessageId})`;
    }

    await announce(snap);
    if (isTerminal(snap.status)) await cleanupOrphans();

    await db.$executeRaw`UPDATE "Match" SET "syncedVersion" = ${version} WHERE "id" = ${id} AND "syncedVersion" < ${version}`;
  }

  /**
   * 008 §7: a team channel is an orphan when its name matches, it sits in a managed category,
   * and no non-terminal match holds its id. A channel whose #id names a non-terminal match is
   * left to that match's own sync (it may be mid-create, its id not saved yet).
   */
  async function cleanupOrphans(): Promise<number> {
    const since = new Date(deps.clock.now().getTime() - ORPHAN_WINDOW_MS);
    const settings = await deps.settings.get();
    const matches = await db.match.findMany({
      where: { OR: [{ status: { in: [...OPEN_STATUSES] } }, { endedAt: { gte: since } }] },
      select: { id: true, status: true, voiceCategoryId: true, voiceChannelAId: true, voiceChannelBId: true },
    });
    const categories = [...new Set([settings.defaultVoiceCategoryId, ...matches.map((m) => m.voiceCategoryId)])].filter(
      (c): c is string => Boolean(c),
    );
    if (categories.length === 0) return 0;

    const open = matches.filter((m) => !isTerminal(m.status));
    const held = new Set(open.flatMap((m) => [m.voiceChannelAId, m.voiceChannelBId]).filter(Boolean));
    const openIds = new Set(open.map((m) => m.id));

    let deleted = 0;
    for (const channel of await gateway.listVoiceChannels(categories)) {
      const match = VOICE_CHANNEL_NAME_RE.exec(channel.name);
      if (!match || held.has(channel.id) || openIds.has(Number(match[2]))) continue;
      await gateway.deleteChannel(channel.id);
      deleted++;
      await logging.event('match.orphan_deleted', { channelId: channel.id, name: channel.name });
    }
    if (deleted > 0) {
      await logging.event('match.orphans', { deleted }, `🧹 Удалено осиротевших голосовых каналов матчей: ${deleted}.`);
    }
    return deleted;
  }

  return { sync, cleanupOrphans };
}
