// `sync` against the fake gateway (decisions 004 §6, 008 §5, §7, §8), startup needs, and the
// recruit timeout job (009 §5). The fake gateway runs the production ensure algorithm.
import { describe, expect, it } from 'vitest';
import { voiceChannelName } from '../../../src/core/match.js';
import { runRecruitTimeout, staleCutoff } from '../../../src/jobs/recruitTimeout.js';
import { runSyncRetry } from '../../../src/jobs/syncRetry.js';
import { createSettingsService } from '../../../src/modules/settings/service.js';
import { testDb } from '../helpers.js';
import { CATEGORY, expectInvariants, fill, harness, newMatch, ORGANISER, OWNER, player, RECRUIT, startedMatch } from './harness.js';

const db = testDb;
const HOUR = 3_600_000;

describe('sync', () => {
  it('posts the recruitment message once and edits it afterwards; records syncedVersion', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await h.matches.sync(id);
    await h.matches.join(id, player(1));
    await h.matches.sync(id);

    const ids = new Set(h.gateway.renders.map((r) => r.messageId));
    expect(ids.size).toBe(1);
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.recruitMessageId).toBe([...ids][0]);
    expect(m.syncedVersion).toBe(m.version);
  });

  it('reposts a deleted recruitment message and stores the new id', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await h.matches.sync(id);
    const first = (await db().match.findUniqueOrThrow({ where: { id } })).recruitMessageId!;
    h.gateway.messages.delete(first);
    await h.matches.sync(id);
    const second = (await db().match.findUniqueOrThrow({ where: { id } })).recruitMessageId!;
    expect(second).not.toBe(first);
  });

  it('run twice, creates each team channel exactly once', async () => {
    const h = await harness();
    const { id } = await startedMatch(h);
    await h.matches.sync(id);
    await h.matches.sync(id);
    expect(h.gateway.created).toHaveLength(2);
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(h.gateway.channels.get(m.voiceChannelAId!)?.name).toBe(voiceChannelName('A', id));
    expect(h.gateway.channels.get(m.voiceChannelBId!)?.name).toBe(voiceChannelName('B', id));
    expect(h.gateway.announcements.filter((a) => a.status === 'IN_PROGRESS')).toHaveLength(1);
  });

  it('adopts a channel by its name after a crash between «created» and «id saved»', async () => {
    const h = await harness();
    const { id } = await startedMatch(h);
    h.gateway.crashAfterNextCreate = true;
    await expect(h.matches.sync(id)).rejects.toThrow(/simulated crash/);
    expect((await db().match.findUniqueOrThrow({ where: { id } })).voiceChannelAId).toBeNull();

    await h.matches.sync(id);
    expect(h.gateway.created).toHaveLength(2); // A once (adopted), B once
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.voiceChannelAId).toBe(h.gateway.created[0]);
    expect(m.syncedVersion).toBe(m.version);
  });

  it('a transition landing mid-sync leaves syncedVersion < version, so the next sync runs', async () => {
    const h = await harness();
    const id = await newMatch(h);
    h.gateway.duringRender = async () => {
      await h.matches.join(id, player(1));
    };
    await h.matches.sync(id);
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.syncedVersion).toBeLessThan(m.version);
    expect(await h.matches.needingSync()).toContain(id);
  });

  it('gives organisers both channels in TEAMS_PENDING and teams their own from IN_PROGRESS', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    const players = await fill(h, id, 4);
    await h.matches.sync(id);
    let m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(h.gateway.channels.get(m.voiceChannelAId!)?.allowUserIds).toEqual([ORGANISER.userId]);
    expect(h.gateway.channels.get(m.voiceChannelAId!)?.allowRoleIds).toEqual(['600000000000000001']);

    const v = await h.matches.assignTeamA(ORGANISER, id, [players[0]!, players[1]!]);
    await h.matches.confirmTeams(ORGANISER, id, v);
    await h.matches.sync(id);
    m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(h.gateway.channels.get(m.voiceChannelAId!)?.allowUserIds.sort()).toEqual([ORGANISER.userId, players[0], players[1]].sort());
    expect(h.gateway.channels.get(m.voiceChannelBId!)?.allowUserIds.sort()).toEqual([ORGANISER.userId, players[2], players[3]].sort());
    expect(h.gateway.created).toHaveLength(2);
    expect(h.gateway.moves).toHaveLength(2); // autoMoveToVoice is on in the harness
  });

  it('deletes the channels on reopen and at the end, and cleans up orphans by name', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    await fill(h, id, 4);
    await h.matches.sync(id);
    await h.matches.removeParticipant(ORGANISER, id, player(1));
    await h.matches.sync(id);
    expect(h.gateway.channels.size).toBe(0);
    let m = await db().match.findUniqueOrThrow({ where: { id } });
    expect([m.voiceChannelAId, m.voiceChannelBId]).toEqual([null, null]);

    const orphan = h.gateway.addChannel(voiceChannelName('B', 4242), CATEGORY);
    const stranger = h.gateway.addChannel('🔊 общий', CATEGORY);
    await h.matches.cancel(ORGANISER, id, (await h.matches.get(id)).version);
    await h.matches.sync(id);
    expect(h.gateway.channels.has(orphan)).toBe(false);
    expect(h.gateway.channels.has(stranger)).toBe(true);
    m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.announcedStatus).toBe('CANCELLED');
  });

  it('never deletes a channel whose #id names an open match (it may be mid-create)', async () => {
    const h = await harness();
    const open = await newMatch(h);
    const kept = h.gateway.addChannel(voiceChannelName('A', open), CATEGORY);
    expect(await h.matches.cleanupOrphans()).toBe(0);
    expect(h.gateway.channels.has(kept)).toBe(true);
  });

  it('announces each status once: teams, start, result', async () => {
    const h = await harness();
    const id = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    const players = await fill(h, id, 4);
    await h.matches.sync(id);
    await h.matches.sync(id);
    const v = await h.matches.assignTeamA(ORGANISER, id, [players[0]!, players[1]!]);
    await h.matches.confirmTeams(ORGANISER, id, v);
    await h.matches.sync(id);
    await h.matches.finish(ORGANISER, { id, version: v + 1, winner: 'A', mvpUserId: null });
    await h.matches.sync(id);
    await h.matches.sync(id);
    expect(h.gateway.announcements.map((a) => a.status)).toEqual(['TEAMS_PENDING', 'IN_PROGRESS', 'FINISHED']);
    expect(h.gateway.announcements.every((a) => a.channelId === RECRUIT)).toBe(true);
    expect(h.gateway.channels.size).toBe(0);
  });

  it('never hands a fake player id to the gateway', async () => {
    const h = await harness();
    const id = await newMatch(h);
    await h.matches.addTestPlayers(OWNER, id);
    await h.matches.join(id, OWNER.userId);
    await h.matches.sync(id);
    await h.matches.reconcileMembership();
    const snap = await h.matches.get(id);
    await h.matches.finish(OWNER, { id, version: snap.version, winner: 'A', mvpUserId: null });
    await h.matches.sync(id);
    expect(h.gateway.leaks).toEqual([]);
    expect(h.gateway.moves.flatMap((m) => m.userIds)).toEqual([OWNER.userId]);
    await expectInvariants(); // fake players were paid like real ones, in the test database
  });

  it('transitions schedule a coalesced sync by themselves; create waits for its first sync', async () => {
    const h = await harness({ autoSync: true });
    const id = await newMatch(h);
    expect(h.gateway.renders).toHaveLength(1); // create awaited it
    await Promise.all([1, 2, 3, 4, 5].map((k) => h.matches.join(id, player(k))));
    await h.matches.idle();
    expect(h.gateway.renders.length).toBeGreaterThanOrEqual(2);
    expect(h.gateway.renders.length).toBeLessThanOrEqual(6);
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.syncedVersion).toBe(m.version);
  });
});

describe('needingSync', () => {
  it('lists open matches and terminal ones with syncedVersion < version', async () => {
    const h = await harness();
    const open = await newMatch(h);
    const done = await newMatch(h);
    await h.matches.cancel(ORGANISER, done, (await h.matches.get(done)).version);
    const synced = await newMatch(h);
    await h.matches.cancel(ORGANISER, synced, (await h.matches.get(synced)).version);
    await h.matches.sync(synced);
    expect(await h.matches.needingSync()).toEqual([open, done]);
  });
});

describe('sync retry (review 2026-09-20)', () => {
  it('unsynced lists exactly the matches whose Discord side lags, open or not', async () => {
    const h = await harness();
    const lagging = await newMatch(h);
    const synced = await newMatch(h);
    await h.matches.sync(synced);
    const ended = await newMatch(h);
    await h.matches.cancel(ORGANISER, ended, (await h.matches.get(ended)).version);
    expect(await h.matches.unsynced()).toEqual([lagging, ended]);
  });

  it('a failing sync is retried by the job, told to the log channel once per version, and repaired when Discord is back', async () => {
    const h = await harness({ autoSync: true });
    const id = await newMatch(h);
    h.gateway.failRenders = true;
    await h.matches.join(id, player(1));
    await h.matches.idle();
    await runSyncRetry({ matches: h.matches, logging: h.logging });
    await runSyncRetry({ matches: h.matches, logging: h.logging });
    await flush();
    const failures = () => h.logging.events.filter((e) => e.name === 'match.sync_failed');
    expect(failures()).toHaveLength(3); // the join's sync and two retries, all in the process log
    expect(failures().filter((e) => e.audit)).toHaveLength(1); // the log channel heard it once

    await h.matches.join(id, player(2)); // a new version fails again: one more channel line
    await h.matches.idle();
    await flush();
    expect(failures().filter((e) => e.audit)).toHaveLength(2);

    h.gateway.failRenders = false;
    expect(await runSyncRetry({ matches: h.matches, logging: h.logging })).toEqual([id]);
    const m = await db().match.findUniqueOrThrow({ where: { id } });
    expect(m.syncedVersion).toBe(m.version);
    expect(await h.matches.unsynced()).toEqual([]);
  });
});

/** Failure reports are fire-and-forget (they read the version first); let them land. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 20));
}

describe('recruit timeout job (decision 009 §5)', () => {
  it('computes no cutoff for 0 hours and an exact one otherwise', () => {
    const now = new Date('2026-09-19T12:00:00Z');
    expect(staleCutoff(now, 0)).toBeNull();
    expect(staleCutoff(now, 3)).toEqual(new Date('2026-09-19T09:00:00Z'));
  });

  it('cancels only RECRUITING matches older than the timeout, as the system; no KP moves', async () => {
    const h = await harness();
    const old = await newMatch(h);
    const oldFull = await newMatch(h, { teamMode: 'MANUAL', teamSize: 2 });
    await fill(h, oldFull, 4); // TEAMS_PENDING never times out
    h.clock.advance(2 * HOUR);
    const fresh = await newMatch(h);
    h.clock.advance(1.5 * HOUR); // old: 3.5 h, fresh: 1.5 h

    const cancelled = await runRecruitTimeout({ settings: createSettingsService(db()), matches: h.matches, logging: h.logging, clock: h.clock });

    expect(cancelled).toEqual([old]);
    expect(await db().match.findUniqueOrThrow({ where: { id: old } })).toMatchObject({ status: 'CANCELLED', endedById: null });
    expect((await h.matches.get(oldFull)).status).toBe('TEAMS_PENDING');
    expect((await h.matches.get(fresh)).status).toBe('RECRUITING');
    expect(await db().kpTransaction.count()).toBe(0);
    expect(h.logging.events.find((e) => e.name === 'match.cancelled')?.audit).toMatch(/набор закрыт по времени/);
    await expectInvariants();
  });

  it('0 hours means never', async () => {
    const h = await harness();
    const settings = createSettingsService(db());
    await settings.update({ recruitTimeoutHours: 0 });
    const id = await newMatch(h);
    h.clock.advance(1000 * HOUR);
    expect(await runRecruitTimeout({ settings, matches: h.matches, logging: h.logging, clock: h.clock })).toEqual([]);
    expect((await h.matches.get(id)).status).toBe('RECRUITING');
  });
});
