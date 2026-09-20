// An in-memory GuildGateway for tests. It runs the SAME ensure algorithm as the real gateway
// (src/core/ensureChannel.ts), so «created once», «adopted by name after a crash» are proven on
// the production steps. Any fake player id that reaches an id-taking method is recorded in
// `leaks` and fails the call: fake ids must be filtered before the gateway (decision 008 §10).
import { ensureChannel } from '../../src/core/ensureChannel.js';
import { isFakeUserId, type MatchSnapshot, type MatchStatusName } from '../../src/core/match.js';
import { belongsToGuild } from '../../src/discord/missing.js';
import type {
  AccessChannelCheck,
  AccessPermission,
  AccessReport,
  GuildGateway,
  PlayerNotice,
  RoleCheck,
  RoleSpec,
  RoomCategoryCheck,
  RoomChannelSpec,
  VoiceChannelInfo,
  VoiceChannelSpec,
  VoiceSnapshot,
} from '../../src/core/ports.js';

export interface FakeRole {
  id: string;
  name: string;
  color: number;
  /** Placed directly below this role by the last creation or restyle. */
  below: string | null;
}

export interface FakeRoom {
  id: string;
  name: string;
  categoryId: string;
  userLimit: number;
  locked: boolean;
  allowUserIds: string[];
}

interface FakeChannel extends VoiceChannelInfo {
  /** The guild it lives in: an id left behind by another guild must never be adopted. */
  guildId: string;
  allowUserIds: string[];
  allowRoleIds: string[];
}

/** The guild the fake serves; `addForeignChannel` puts a channel outside it. */
export const FAKE_GUILD_ID = '100000000000000001';
export const OTHER_GUILD_ID = '100000000000000002';

export class FakeGateway implements GuildGateway {
  guildId = FAKE_GUILD_ID;

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

  /** Same rule as the real one: an id of another guild is «not there» (src/discord/missing.ts). */
  private ownChannel(id: string): FakeChannel | null {
    const channel = this.channels.get(id);
    return channel && belongsToGuild(channel, this.guildId) ? channel : null;
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
      byId: (id) => Promise.resolve(this.ownChannel(id) ? { id } : null),
      byName: (categoryId, name) =>
        Promise.resolve(
          [...this.channels.values()].find((c) => belongsToGuild(c, this.guildId) && c.parentId === categoryId && c.name === name) ?? null,
        ),
      create: (s) => {
        const channel: FakeChannel = {
          id: this.id(),
          name: s.name,
          parentId: s.categoryId,
          guildId: this.guildId,
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
    if (this.channels.get(id) && !this.ownChannel(id)) return Promise.resolve(); // another guild's: not ours to delete
    if (this.channels.delete(id) || this.rooms.delete(id)) this.deleted.push(id); // unknown counts as done
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
      [...this.channels.values()]
        .filter((c) => belongsToGuild(c, this.guildId) && c.parentId !== null && categoryIds.includes(c.parentId))
        .map(({ id, name, parentId }) => ({ id, name, parentId })),
    );
  }

  /** Recruit channels that do not resolve here: deleted, or left in a guild we no longer serve. */
  readonly goneChannels = new Set<string>();

  checkRecruitChannel(channelId: string): Promise<string[]> {
    if (this.goneChannels.has(channelId)) return Promise.resolve(['NotFound']);
    return Promise.resolve([...this.missingRecruit]);
  }

  checkVoiceCategory(): Promise<string[]> {
    return Promise.resolve([...this.missingVoice]);
  }

  /** Adds a channel as if someone (or a crashed run) had created it. */
  addChannel(name: string, parentId: string): string {
    const id = this.id();
    this.channels.set(id, { id, name, parentId, guildId: this.guildId, allowUserIds: [], allowRoleIds: [] });
    return id;
  }

  /** A channel left behind in a guild this deployment no longer serves (2026-09-20 defect). */
  addForeignChannel(name: string, parentId: string): string {
    const id = this.id();
    this.channels.set(id, { id, name, parentId, guildId: OTHER_GUILD_ID, allowUserIds: [], allowRoleIds: [] });
    return id;
  }

  // ─── Shop (decision 014 §3) ───────────────────────────────────────────────

  readonly roles = new Map<string, FakeRole>();
  /** userId → role ids held. */
  readonly memberRoles = new Map<string, Set<string>>();
  readonly roleCreates: string[] = [];
  readonly roleDeletes: string[] = [];
  /** Every role give/take, in order: `+role:user` / `-role:user`. */
  readonly roleOps: string[] = [];
  /** Roles above the bot's highest role. */
  readonly rolesAboveBot = new Set<string>();
  /** Role names that exist on the server besides the bot's own roles. */
  serverRoleNames: string[] = ['@everyone', 'Модератор'];
  canManageRoles = true;
  /** Every setMemberRole throws while set: Discord refuses (50013). */
  failRoleOps = false;
  /** Access channels that exist; value: @everyone already holds the permission there. */
  readonly accessChannels = new Map<string, { everyoneHas: boolean; otherRoleIds: string[]; missing: string[] }>();
  /** channelId → overwrites written: role allow and @everyone deny per permission. */
  readonly accessOverwrites = new Map<string, { roleId: string; permissions: AccessPermission[] }>();
  readonly accessCleared: string[] = [];
  readonly rooms = new Map<string, FakeRoom>();
  readonly roomCreates: string[] = [];
  roomCategoryMissing: string[] = [];
  roomCategoryCount = 0;
  failRoomChannel = false;
  readonly disconnects: { userId: string; channelId: string }[] = [];
  voice: VoiceSnapshot = { afkChannelId: null, channels: [] };
  readonly dms: { userId: string; notice: PlayerNotice }[] = [];
  /** Users who do not accept private messages (50007). */
  readonly dmClosed = new Set<string>();

  /** Every positioning (after a creation or a restyle) throws while set: `setPosition` refused. */
  failPlacement = false;

  // Same steps as the real ensureRole: create → onCreated → position (decision 017 §1).
  async ensureRole(spec: RoleSpec): Promise<string> {
    let role = spec.currentId ? (this.roles.get(spec.currentId) ?? null) : null;
    if (!role && spec.adoptByName) role = [...this.roles.values()].find((r) => r.name === spec.name) ?? null;
    let placed = false;
    if (!role) {
      role = { id: this.id(), name: spec.name, color: spec.color, below: null };
      this.roles.set(role.id, role);
      this.roleCreates.push(role.id);
      if (spec.onCreated) await spec.onCreated(role.id);
      placed = true;
    } else if (spec.restyle) {
      Object.assign(role, { name: spec.name, color: spec.color });
      placed = true;
    }
    if (placed && spec.belowRoleId) {
      if (this.failPlacement) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      role.below = spec.belowRoleId;
    }
    return role.id;
  }

  deleteRole(id: string): Promise<void> {
    if (this.roles.delete(id)) this.roleDeletes.push(id);
    for (const held of this.memberRoles.values()) held.delete(id);
    return Promise.resolve();
  }

  roleMembers(roleId: string): Promise<string[]> {
    return Promise.resolve([...this.memberRoles].filter(([, held]) => held.has(roleId)).map(([userId]) => userId));
  }

  setMemberRole(userId: string, roleId: string, on: boolean): Promise<'done' | 'absent'> {
    this.real([userId], 'setMemberRole');
    if (this.failRoleOps) return Promise.reject(Object.assign(new Error('Missing Permissions'), { code: 50013 }));
    if (this.absent.has(userId)) return Promise.resolve('absent');
    const held = this.memberRoles.get(userId) ?? new Set<string>();
    if (on) held.add(roleId);
    else held.delete(roleId);
    this.memberRoles.set(userId, held);
    this.roleOps.push(`${on ? '+' : '-'}${roleId}:${userId}`);
    return Promise.resolve('done');
  }

  /** Does the member hold the role right now? */
  holds(userId: string, roleId: string | null | undefined): boolean {
    return roleId ? (this.memberRoles.get(userId)?.has(roleId) ?? false) : false;
  }

  roleManageable(roleId: string | null): Promise<RoleCheck> {
    const exists = roleId !== null && (this.roles.has(roleId) || this.extraRoles.has(roleId));
    return Promise.resolve({ botCanManageRoles: this.canManageRoles, exists, belowBot: exists && !this.rolesAboveBot.has(roleId) });
  }

  /** Server roles the bot did not create (an anchor, staff). */
  readonly extraRoles = new Set<string>();

  guildRoleNames(): Promise<string[]> {
    return Promise.resolve([...this.serverRoleNames, ...[...this.roles.values()].map((r) => r.name)]);
  }

  checkAccessChannel(channelId: string): Promise<AccessChannelCheck> {
    const c = this.accessChannels.get(channelId);
    if (!c) return Promise.resolve({ exists: false, missing: ['NotFound'], everyoneHas: false });
    return Promise.resolve({ exists: true, missing: [...c.missing], everyoneHas: c.everyoneHas });
  }

  async ensureAccessOverwrites(channelId: string, roleId: string, permissions: readonly AccessPermission[]): Promise<AccessReport> {
    const check = await this.checkAccessChannel(channelId);
    if (!check.exists) return { ...check, otherRoleIds: [] };
    if (check.missing.length === 0) this.accessOverwrites.set(channelId, { roleId, permissions: [...permissions] });
    const c = this.accessChannels.get(channelId);
    if (c && check.missing.length === 0) c.everyoneHas = false;
    return { ...(await this.checkAccessChannel(channelId)), otherRoleIds: [...(c?.otherRoleIds ?? [])] };
  }

  clearAccessOverwrite(channelId: string): Promise<void> {
    this.accessOverwrites.delete(channelId);
    this.accessCleared.push(channelId);
    return Promise.resolve();
  }

  ensureRoomChannel(spec: RoomChannelSpec): Promise<string> {
    this.real(spec.allowUserIds, 'ensureRoomChannel');
    if (this.failRoomChannel) return Promise.reject(Object.assign(new Error('Missing Access'), { code: 50001 }));
    let room = spec.currentId ? (this.rooms.get(spec.currentId) ?? null) : null;
    if (!room) room = [...this.rooms.values()].find((r) => r.categoryId === spec.categoryId && r.name === spec.name && !spec.claimedIds.includes(r.id)) ?? null;
    if (!room) {
      room = { id: this.id(), name: spec.name, categoryId: spec.categoryId, userLimit: 0, locked: true, allowUserIds: [] };
      this.rooms.set(room.id, room);
      this.roomCreates.push(room.id);
    }
    Object.assign(room, { name: spec.name, userLimit: spec.userLimit, locked: spec.locked, allowUserIds: [...spec.allowUserIds] });
    return Promise.resolve(room.id);
  }

  checkRoomCategory(): Promise<RoomCategoryCheck> {
    return Promise.resolve({ missing: [...this.roomCategoryMissing], channelCount: this.roomCategoryCount });
  }

  disconnect(userId: string, channelId: string): Promise<void> {
    this.real([userId], 'disconnect');
    this.disconnects.push({ userId, channelId });
    return Promise.resolve();
  }

  voiceSnapshot(): Promise<VoiceSnapshot> {
    return Promise.resolve(this.voice);
  }

  sendDm(userId: string, notice: PlayerNotice): Promise<'sent' | 'refused'> {
    this.real([userId], 'sendDm');
    if (this.dmClosed.has(userId)) return Promise.resolve('refused');
    this.dms.push({ userId, notice });
    return Promise.resolve('sent');
  }
}
