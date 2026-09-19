// Ports: what the domain modules need done in Discord, without importing discord.js (002 §2).
// src/discord/gateway.ts implements them; tests use fakes. Every method must be idempotent —
// side effects are replayed by reconcilers and `sync`, never inside a db transaction.
import type { MatchSnapshot, MatchStatusName } from './match.js';

/** A team voice channel as `sync` wants it (decision 008 §7). */
export interface VoiceChannelSpec {
  categoryId: string;
  /** Exact name, `🔵 Команда A · #<matchId>`; the second way to find the channel again. */
  name: string;
  /** The stored id, tried first; null when none is stored yet. */
  currentId: string | null;
  /** Members allowed View + Connect: the creator, and the team from IN_PROGRESS on. */
  allowUserIds: readonly string[];
  /** Roles allowed View + Connect: every role holding MATCH_MANAGE_ANY. */
  allowRoleIds: readonly string[];
}

export interface VoiceChannelInfo {
  id: string;
  name: string;
  parentId: string | null;
}

/** Bot permissions a channel or category lacks, as Discord permission flag names. */
export type MissingPermissions = string[];

// ─── Shop (decisions 014 §3, 015) ───────────────────────────────────────────

/** What `channel_permission` goods grant in the chosen channels. */
export type AccessPermission = 'AttachFiles' | 'EmbedLinks';

/** A bot-owned role: no guild permissions, not hoisted, not mentionable (014 §3). */
export interface RoleSpec {
  /** The stored id, tried first; then the exact name; then the role is created. */
  currentId: string | null;
  name: string;
  /** 0xRRGGBB; 0 = no colour. */
  color: number;
  /** Write the name and colour onto an existing role: only on the owner's explicit rename. */
  restyle: boolean;
  /**
   * Adopt a role with exactly this name when the stored id is gone (a crash between «created»
   * and «id saved»). Off for clans: a closed clan's role of the same name may still be there.
   */
  adoptByName: boolean;
  /** Place the role directly below this one on creation and on restyle (decision 015 §4). */
  belowRoleId: string | null;
  reason: string;
}

export interface RoleCheck {
  /** The bot holds Manage Roles on the server. */
  botCanManageRoles: boolean;
  exists: boolean;
  /** Below the bot's highest role, so the bot may give and take it. */
  belowBot: boolean;
}

export interface AccessChannelCheck {
  exists: boolean;
  /** What the bot lacks there to set the overwrites, as Discord flag names. */
  missing: MissingPermissions;
  /** @everyone already holds a granted permission there: buying would change nothing. */
  everyoneHas: boolean;
}

export interface AccessReport extends AccessChannelCheck {
  /** Other roles whose overwrite there allows a granted permission: a warning, never a block. */
  otherRoleIds: string[];
}

/** A personal room as convergence wants it (014 §3.3). */
export interface RoomChannelSpec {
  categoryId: string;
  currentId: string | null;
  name: string;
  /** 0 = no limit. */
  userLimit: number;
  /** Locked: @everyone may see the room but not connect. */
  locked: boolean;
  /** The present owner and guests: View + Connect. */
  allowUserIds: readonly string[];
  /** Channels that belong to other rooms: never adopted by name. */
  claimedIds: readonly string[];
}

export interface RoomCategoryCheck {
  missing: MissingPermissions;
  channelCount: number;
}

// ─── Voice time (014 §6) ────────────────────────────────────────────────────

export interface VoiceMemberState {
  userId: string;
  bot: boolean;
  selfDeaf: boolean;
  serverDeaf: boolean;
}

export interface VoiceChannelState {
  id: string;
  /** A stage channel: never pays. */
  stage: boolean;
  members: VoiceMemberState[];
}

export interface VoiceSnapshot {
  afkChannelId: string | null;
  channels: VoiceChannelState[];
}

/** A private message to a player; the Discord layer renders the words (views). */
export type PlayerNotice =
  | { kind: 'grant_expiring'; goodName: string; expiresAt: Date }
  | { kind: 'grant_refunded'; goodName: string; amount: number };

/** Shop and earnings calls of the gateway; every one is idempotent and skips fake ids. */
export interface ShopGateway {
  ensureRole(spec: RoleSpec): Promise<string>;
  /** «Unknown Role» counts as done. */
  deleteRole(id: string): Promise<void>;
  /** Members holding the role, from the full member cache filled at bind. */
  roleMembers(roleId: string): Promise<string[]>;
  /** Gives or takes the role; a member who is not on the server is `absent`. */
  setMemberRole(userId: string, roleId: string, on: boolean): Promise<'done' | 'absent'>;
  roleManageable(roleId: string | null): Promise<RoleCheck>;
  /** Every role name on the server, @everyone included; its length is the role count. */
  guildRoleNames(): Promise<string[]>;
  checkAccessChannel(channelId: string, permissions: readonly AccessPermission[]): Promise<AccessChannelCheck>;
  /**
   * Per channel, with `permissionOverwrites.edit` per target and never `set` (014 §3.1): the bot
   * keeps the permissions, @everyone is denied them, the role is allowed them.
   */
  ensureAccessOverwrites(channelId: string, roleId: string, permissions: readonly AccessPermission[]): Promise<AccessReport>;
  /** A channel taken off the list: the role's overwrite deleted, @everyone and the bot back to inherit. */
  clearAccessOverwrite(channelId: string, roleId: string | null, permissions: readonly AccessPermission[]): Promise<void>;
  /** Stored id → exact name in the category (unclaimed) → create; name, limit and overwrites set in full. */
  ensureRoomChannel(spec: RoomChannelSpec): Promise<string>;
  checkRoomCategory(categoryId: string): Promise<RoomCategoryCheck>;
  /** Disconnects the member if they sit in this channel; best effort. */
  disconnect(userId: string, channelId: string): Promise<void>;
  voiceSnapshot(): Promise<VoiceSnapshot>;
  /** `refused` = the player does not accept private messages (50007) or is gone. */
  sendDm(userId: string, notice: PlayerNotice): Promise<'sent' | 'refused'>;
}

export interface GuildGateway extends ShopGateway {
  /**
   * Makes sure the bot's log channel exists and returns its id. `currentId` is the stored id;
   * when it is null or the channel is gone, a new admin-only channel is created.
   */
  ensureLogChannel(currentId: string | null): Promise<string>;

  /** Posts or edits the recruitment message; reposts when it was deleted. Returns its id. */
  renderMatchMessage(snapshot: MatchSnapshot, channelId: string, messageId: string | null): Promise<string>;
  /** Stored id → exact name in the category → create. Overwrites are fully replaced. */
  ensureVoiceChannel(spec: VoiceChannelSpec): Promise<string>;
  /** «Unknown Channel» counts as done. */
  deleteChannel(id: string): Promise<void>;
  /** Moves the members who are connected to voice; best effort, never throws per member. */
  moveMembers(userIds: readonly string[], channelId: string): Promise<void>;
  /** One status announcement in the recruit channel (decision 008 §8). */
  announce(channelId: string, snapshot: MatchSnapshot, status: MatchStatusName): Promise<void>;
  /** Which of these users are still members of the guild. */
  presentMembers(userIds: readonly string[]): Promise<Set<string>>;
  listVoiceChannels(categoryIds: readonly string[]): Promise<VoiceChannelInfo[]>;
  /** What the bot lacks in the recruit channel: View, Send, EmbedLinks, ReadHistory. */
  checkRecruitChannel(channelId: string): Promise<MissingPermissions>;
  /** What the bot lacks in the voice category: View, Connect, ManageChannels, ManageRoles, MoveMembers. */
  checkVoiceCategory(categoryId: string): Promise<MissingPermissions>;
}

/** The Discord log channel (rule bot-always-on §3): ids, names and amounts, never secrets. */
export interface AuditLog {
  post(line: string): Promise<void>;
}
