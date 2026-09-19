// An in-memory GuildGateway for tests. It runs the SAME ensure algorithm as the real gateway
// (src/core/ensureChannel.ts), so «created once», «adopted by name after a crash» are proven on
// the production steps. Any fake player id that reaches an id-taking method is recorded in
// `leaks` and fails the call: fake ids must be filtered before the gateway (decision 008 §10).
import { ensureChannel } from '../../src/core/ensureChannel.js';
import { isFakeUserId, type MatchSnapshot, type MatchStatusName } from '../../src/core/match.js';
import type { GuildGateway, VoiceChannelInfo, VoiceChannelSpec } from '../../src/core/ports.js';

interface FakeChannel extends VoiceChannelInfo {
  allowUserIds: string[];
  allowRoleIds: string[];
}

export class FakeGateway implements GuildGateway {
  readonly channels = new Map<string, FakeChannel>();
  readonly messages = new Map<string, { channelId: string; snapshot: MatchSnapshot }>();
  readonly created: string[] = [];
  readonly deleted: string[] = [];
  readonly renders: { matchId: number; status: MatchStatusName; messageId: string }[] = [];
  readonly announcements: { channelId: string; matchId: number; status: MatchStatusName; snapshot: MatchSnapshot }[] = [];
  readonly moves: { userIds: string[]; channelId: string }[] = [];
  readonly leaks: string[] = [];
  /** Users presentMembers reports as gone. */
  readonly absent = new Set<string>();
  missingRecruit: string[] = [];
  missingVoice: string[] = [];
  /** Create the next channel, then throw — a crash before its id reaches the database. */
  crashAfterNextCreate = false;
  /** Runs inside renderMatchMessage, before it returns: a transition landing mid-sync. */
  duringRender: (() => Promise<void>) | null = null;
  /** Every renderMatchMessage throws while set: Discord is down. */
  failRenders = false;
  private nextId = 900_000_000_000_000_000n;

  private id(): string {
    this.nextId += 1n;
    return String(this.nextId);
  }

  private real(ids: readonly string[], where: string): void {
    const fake = ids.filter(isFakeUserId);
    if (fake.length > 0) {
      this.leaks.push(...fake);
      throw new Error(`fake user ids reached gateway.${where}: ${fake.join(', ')}`);
    }
  }

  ensureLogChannel(currentId: string | null): Promise<string> {
    return Promise.resolve(currentId ?? 'log-channel');
  }

  async renderMatchMessage(snapshot: MatchSnapshot, channelId: string, messageId: string | null): Promise<string> {
    if (this.failRenders) throw new Error('simulated Discord outage');
    const id = messageId && this.messages.has(messageId) ? messageId : this.id();
    this.messages.set(id, { channelId, snapshot });
    this.renders.push({ matchId: snapshot.id, status: snapshot.status, messageId: id });
    if (this.duringRender) {
      const hook = this.duringRender;
      this.duringRender = null;
      await hook();
    }
    return id;
  }

  async ensureVoiceChannel(spec: VoiceChannelSpec): Promise<string> {
    this.real(spec.allowUserIds, 'ensureVoiceChannel');
    return ensureChannel(spec, {
      byId: (id) => Promise.resolve(this.channels.has(id) ? { id } : null),
      byName: (categoryId, name) =>
        Promise.resolve([...this.channels.values()].find((c) => c.parentId === categoryId && c.name === name) ?? null),
      create: (s) => {
        const channel: FakeChannel = {
          id: this.id(),
          name: s.name,
          parentId: s.categoryId,
          allowUserIds: [...s.allowUserIds],
          allowRoleIds: [...s.allowRoleIds],
        };
        this.channels.set(channel.id, channel);
        this.created.push(channel.id);
        if (this.crashAfterNextCreate) {
          this.crashAfterNextCreate = false;
          return Promise.reject(new Error('simulated crash after the channel was created'));
        }
        return Promise.resolve({ id: channel.id });
      },
      setOverwrites: (id, s) => {
        const channel = this.channels.get(id);
        if (channel) Object.assign(channel, { allowUserIds: [...s.allowUserIds], allowRoleIds: [...s.allowRoleIds] });
        return Promise.resolve();
      },
    });
  }

  deleteChannel(id: string): Promise<void> {
    if (this.channels.delete(id)) this.deleted.push(id); // unknown counts as done
    return Promise.resolve();
  }

  moveMembers(userIds: readonly string[], channelId: string): Promise<void> {
    this.real(userIds, 'moveMembers');
    this.moves.push({ userIds: [...userIds], channelId });
    return Promise.resolve();
  }

  announce(channelId: string, snapshot: MatchSnapshot, status: MatchStatusName): Promise<void> {
    this.announcements.push({ channelId, matchId: snapshot.id, status, snapshot });
    return Promise.resolve();
  }

  presentMembers(userIds: readonly string[]): Promise<Set<string>> {
    this.real(userIds, 'presentMembers');
    return Promise.resolve(new Set(userIds.filter((u) => !this.absent.has(u))));
  }

  listVoiceChannels(categoryIds: readonly string[]): Promise<VoiceChannelInfo[]> {
    return Promise.resolve(
      [...this.channels.values()].filter((c) => c.parentId !== null && categoryIds.includes(c.parentId)).map(({ id, name, parentId }) => ({ id, name, parentId })),
    );
  }

  checkRecruitChannel(): Promise<string[]> {
    return Promise.resolve([...this.missingRecruit]);
  }

  checkVoiceCategory(): Promise<string[]> {
    return Promise.resolve([...this.missingVoice]);
  }

  /** Adds a channel as if someone (or a crashed run) had created it. */
  addChannel(name: string, parentId: string): string {
    const id = this.id();
    this.channels.set(id, { id, name, parentId, allowUserIds: [], allowRoleIds: [] });
    return id;
  }
}
