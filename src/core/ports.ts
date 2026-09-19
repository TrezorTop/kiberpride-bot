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

export interface GuildGateway {
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
