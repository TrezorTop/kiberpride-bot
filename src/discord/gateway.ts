// Implements the domain ports on top of discord.js (decision 002 §2). Every method is
// idempotent: a replay after a crash must leave the same Discord state, never a duplicate.
// Fake player ids (008 §10) are dropped at every method that takes user ids.
import {
  ChannelType,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
  type PermissionResolvable,
  type Role,
} from 'discord.js';
import { ensureChannel } from '../core/ensureChannel.js';
import { isFakeUserId, type MatchSnapshot, type MatchStatusName } from '../core/match.js';
import type {
  AccessChannelCheck,
  AccessPermission,
  AccessReport,
  AuditLog,
  GuildGateway,
  MissingPermissions,
  PlayerNotice,
  RoleCheck,
  RoleSpec,
  RoomCategoryCheck,
  RoomChannelSpec,
  VoiceChannelInfo,
  VoiceChannelSpec,
  VoiceMemberState,
  VoiceSnapshot,
} from '../core/ports.js';
import type { Logger } from '../modules/logging/logger.js';
import { clearAccessOverwrites, otherRolesAllowing, writeAccessOverwrites } from './accessOverwrites.js';
import type { GuildBinding } from './router.js';
import { announcementView, recruitmentView } from './views/matches.js';
import { playerNoticeEmbed } from './views/shop.js';
import { noticeEmbed } from './views/style.js';

export const LOG_CHANNEL_NAME = 'kp-логи';

// Decision 008 §2: what the bot must hold where. Names are Discord's flag names.
const RECRUIT_NEEDS = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'] as const;
const VOICE_NEEDS = ['ViewChannel', 'Connect', 'ManageChannels', 'ManageRoles', 'MoveMembers'] as const;
// 008 §7: only View and Connect are granted — the permissions the bot itself holds. Speak is inherited.
const SEE_AND_JOIN = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];
const BOT_IN_TEAM_CHANNEL = [...SEE_AND_JOIN, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers];
const MEMBER_FETCH_CHUNK = 100;

const real = (ids: readonly string[]) => ids.filter((id) => !isFakeUserId(id));

export class DiscordGateway implements GuildGateway, AuditLog {
  private logChannelId: string | null = null;

  constructor(
    private readonly client: Client,
    private readonly binding: GuildBinding,
    private readonly log?: Pick<Logger, 'warn'>,
  ) {}

  async ensureLogChannel(currentId: string | null): Promise<string> {
    const guild = await this.guild();
    if (currentId) {
      const existing = await guild.channels.fetch(currentId).catch((err: unknown) => {
        if (isUnknown(err)) return null; // deleted by someone: recreate below
        throw err; // anything else (network, rights) must not create a duplicate channel
      });
      if (existing?.type === ChannelType.GuildText) {
        this.logChannelId = existing.id;
        return existing.id;
      }
    }

    const botId = this.botId();
    // Hidden from @everyone; admins see it through the Administrator permission.
    const created = await guild.channels.create({
      name: LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: 'Журнал бота KiberPride: покупки, награды, матчи, ошибки.',
      reason: 'KiberPride Bot: log channel (rule bot-always-on §3)',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: botId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });
    this.logChannelId = created.id;
    return created.id;
  }

  async post(line: string): Promise<void> {
    if (!this.logChannelId) throw new Error('log channel not ensured yet');
    const channel = await this.client.channels.fetch(this.logChannelId);
    if (!channel?.isSendable()) throw new Error(`log channel ${this.logChannelId} is not sendable`);
    await channel.send({ embeds: [noticeEmbed(line)], allowedMentions: { parse: [] } });
  }

  // ─── Matches (decision 008 §12) ───────────────────────────────────────────

  async renderMatchMessage(snapshot: MatchSnapshot, channelId: string, messageId: string | null): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`recruit channel ${channelId} is not sendable`);
    const view = recruitmentView(snapshot);
    const payload = { embeds: view.embeds, components: view.components, allowedMentions: { parse: [] } };
    if (messageId) {
      try {
        await channel.messages.edit(messageId, payload);
        return messageId;
      } catch (err) {
        if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage)) throw err;
        // deleted by someone: repost below, the caller stores the new id (004 §6)
      }
    }
    const sent = await channel.send(payload);
    return sent.id;
  }

  async ensureVoiceChannel(spec: VoiceChannelSpec): Promise<string> {
    const guild = await this.guild();
    const overwrites = this.teamOverwrites(guild, spec);
    return ensureChannel(spec, {
      byId: async (id) => {
        const channel = await guild.channels.fetch(id).catch((err: unknown) => {
          if (isUnknown(err)) return null;
          throw err;
        });
        return channel?.type === ChannelType.GuildVoice ? channel : null;
      },
      byName: async (categoryId, name) => {
        const all = await guild.channels.fetch();
        return all.find((c) => c?.type === ChannelType.GuildVoice && c.parentId === categoryId && c.name === name) ?? null;
      },
      create: (s) =>
        guild.channels.create({
          name: s.name,
          type: ChannelType.GuildVoice,
          parent: s.categoryId,
          permissionOverwrites: overwrites,
          reason: 'KiberPride Bot: team voice channel (decision 008 §7)',
        }),
      setOverwrites: async (id) => {
        const channel = await guild.channels.fetch(id);
        if (channel?.type === ChannelType.GuildVoice) await channel.permissionOverwrites.set(overwrites);
      },
    });
  }

  async deleteChannel(id: string): Promise<void> {
    const guild = await this.guild();
    try {
      const channel = await guild.channels.fetch(id);
      await channel?.delete('KiberPride Bot: match channel no longer needed');
    } catch (err) {
      if (!isUnknown(err)) throw err; // «Unknown Channel» counts as done (008 §7)
    }
  }

  async moveMembers(userIds: readonly string[], channelId: string): Promise<void> {
    const guild = await this.guild();
    for (const id of real(userIds)) {
      try {
        const member = await guild.members.fetch(id);
        if (member.voice.channelId && member.voice.channelId !== channelId) await member.voice.setChannel(channelId);
      } catch {
        // best effort: a player who left voice or the server just joins by the link
      }
    }
  }

  async announce(channelId: string, snapshot: MatchSnapshot, status: MatchStatusName): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`recruit channel ${channelId} is not sendable`);
    const view = announcementView(snapshot, status);
    await channel.send({
      ...(view.content ? { content: view.content } : {}),
      embeds: view.embeds,
      allowedMentions: { users: real(view.pingUserIds), parse: [] },
    });
  }

  async presentMembers(userIds: readonly string[]): Promise<Set<string>> {
    const guild = await this.guild();
    const ids = real(userIds);
    const present = new Set<string>();
    for (let i = 0; i < ids.length; i += MEMBER_FETCH_CHUNK) {
      const found = await guild.members.fetch({ user: ids.slice(i, i + MEMBER_FETCH_CHUNK) });
      for (const id of found.keys()) present.add(id);
    }
    return present;
  }

  async listVoiceChannels(categoryIds: readonly string[]): Promise<VoiceChannelInfo[]> {
    const guild = await this.guild();
    const all = await guild.channels.fetch();
    return [...all.values()]
      .filter((c): c is NonNullable<typeof c> => c?.type === ChannelType.GuildVoice && c.parentId !== null && categoryIds.includes(c.parentId))
      .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
  }

  async checkRecruitChannel(channelId: string): Promise<MissingPermissions> {
    return this.missing(channelId, (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement, RECRUIT_NEEDS);
  }

  async checkVoiceCategory(categoryId: string): Promise<MissingPermissions> {
    return this.missing(categoryId, (c) => c.type === ChannelType.GuildCategory, VOICE_NEEDS);
  }

  // ─── Shop: roles (decision 014 §3, §9) ────────────────────────────────────

  async ensureRole(spec: RoleSpec): Promise<string> {
    const guild = await this.guild();
    let role = spec.currentId ? await this.roleById(guild, spec.currentId) : null;
    if (!role && spec.adoptByName) role = guild.roles.cache.find((r) => r.name === spec.name && !r.managed) ?? null;
    let placed = false;
    if (!role) {
      role = await guild.roles.create({
        name: spec.name,
        colors: { primaryColor: spec.color },
        permissions: [],
        hoist: false,
        mentionable: false,
        reason: spec.reason,
      });
      placed = true;
    } else if (spec.restyle) {
      await role.edit({ name: spec.name, colors: { primaryColor: spec.color }, reason: spec.reason });
      placed = true;
    }
    // Decision 015 §4: directly below the anchor, so the colour shows over ordinary roles.
    if (placed && spec.belowRoleId) {
      const anchor = guild.roles.cache.get(spec.belowRoleId);
      if (anchor) {
        const target = Math.max(1, role.position < anchor.position ? anchor.position - 1 : anchor.position);
        if (role.position !== target) await role.setPosition(target, { reason: spec.reason });
      }
    }
    return role.id;
  }

  async deleteRole(id: string): Promise<void> {
    const guild = await this.guild();
    try {
      await guild.roles.delete(id, 'KiberPride Bot: the purchase ended');
    } catch (err) {
      if (!hasCode(err, RESTJSONErrorCodes.UnknownRole)) throw err; // «Unknown Role» counts as done
    }
  }

  async roleMembers(roleId: string): Promise<string[]> {
    const guild = await this.guild();
    const role = await this.roleById(guild, roleId);
    return role ? [...role.members.keys()] : [];
  }

  async setMemberRole(userId: string, roleId: string, on: boolean): Promise<'done' | 'absent'> {
    if (isFakeUserId(userId)) return 'absent';
    const guild = await this.guild();
    const member = await guild.members.fetch(userId).catch((err: unknown) => {
      if (hasCode(err, RESTJSONErrorCodes.UnknownMember) || hasCode(err, RESTJSONErrorCodes.UnknownUser)) return null;
      throw err;
    });
    if (!member) return 'absent';
    if (on) {
      if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, 'KiberPride Bot: bought in the shop');
    } else if (member.roles.cache.has(roleId)) {
      try {
        await member.roles.remove(roleId, 'KiberPride Bot: the purchase ended');
      } catch (err) {
        if (!hasCode(err, RESTJSONErrorCodes.UnknownRole)) throw err;
      }
    }
    return 'done';
  }

  async roleManageable(roleId: string | null): Promise<RoleCheck> {
    const guild = await this.guild();
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const botCanManageRoles = me.permissions.has(PermissionFlagsBits.ManageRoles);
    const role = roleId ? await this.roleById(guild, roleId) : null;
    return { botCanManageRoles, exists: role !== null, belowBot: role !== null && me.roles.highest.comparePositionTo(role) > 0 };
  }

  async guildRoleNames(): Promise<string[]> {
    const guild = await this.guild();
    return [...(await guild.roles.fetch()).values()].map((r) => r.name);
  }

  // ─── Shop: access channels (014 §3.1) ─────────────────────────────────────

  async checkAccessChannel(channelId: string, permissions: readonly AccessPermission[]): Promise<AccessChannelCheck> {
    const guild = await this.guild();
    const channel = await this.channelById(guild, channelId);
    if (!channel || !('permissionOverwrites' in channel)) return { exists: false, missing: ['NotFound'], everyoneHas: false };
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const held = channel.permissionsFor(me);
    const needs: (keyof typeof PermissionFlagsBits)[] = ['ViewChannel', 'ManageRoles', ...permissions];
    const everyone = channel.permissionsFor(guild.roles.everyone);
    return {
      exists: true,
      missing: needs.filter((flag) => !held.has(PermissionFlagsBits[flag])),
      everyoneHas: permissions.some((p) => everyone.has(PermissionFlagsBits[p])),
    };
  }

  async ensureAccessOverwrites(channelId: string, roleId: string, permissions: readonly AccessPermission[]): Promise<AccessReport> {
    const check = await this.checkAccessChannel(channelId, permissions);
    const guild = await this.guild();
    const channel = await this.channelById(guild, channelId);
    if (!check.exists || !channel || !('permissionOverwrites' in channel)) return { ...check, otherRoleIds: [] };
    const targets = { everyoneId: guild.roles.everyone.id, botId: this.botId(), roleId };
    if (check.missing.length === 0) {
      await writeAccessOverwrites(channel.permissionOverwrites, targets, permissions, 'KiberPride Bot: access sold in the shop (decision 014 §3.1)');
    }
    const after = await this.checkAccessChannel(channelId, permissions);
    return { ...after, otherRoleIds: otherRolesAllowing(channel.permissionOverwrites, targets, permissions) };
  }

  async clearAccessOverwrite(channelId: string, roleId: string | null, permissions: readonly AccessPermission[]): Promise<void> {
    const guild = await this.guild();
    const channel = await this.channelById(guild, channelId);
    if (!channel || !('permissionOverwrites' in channel)) return; // gone: nothing to give back
    await clearAccessOverwrites(
      channel.permissionOverwrites,
      { everyoneId: guild.roles.everyone.id, botId: this.botId(), roleId },
      permissions,
      'KiberPride Bot: channel taken off the shop list',
    );
  }

  // ─── Shop: personal rooms (014 §3.3) ──────────────────────────────────────

  async ensureRoomChannel(spec: RoomChannelSpec): Promise<string> {
    const guild = await this.guild();
    const overwrites: OverwriteResolvable[] = [
      ...(spec.locked ? [{ id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.Connect] }] : []),
      { id: this.botId(), type: OverwriteType.Member, allow: BOT_IN_TEAM_CHANNEL },
      ...real(spec.allowUserIds).map((id) => ({ id, type: OverwriteType.Member, allow: SEE_AND_JOIN })),
    ];
    const byId = spec.currentId ? await this.channelById(guild, spec.currentId) : null;
    let channel = byId?.type === ChannelType.GuildVoice ? byId : null;
    if (!channel) {
      const all = await guild.channels.fetch();
      channel =
        [...all.values()].find(
          (c): c is NonNullable<typeof c> & { type: ChannelType.GuildVoice } =>
            c?.type === ChannelType.GuildVoice && c.parentId === spec.categoryId && c.name === spec.name && !spec.claimedIds.includes(c.id),
        ) ?? null;
    }
    const reason = 'KiberPride Bot: personal room (decision 014 §3.3)';
    if (!channel) {
      const created = await guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildVoice,
        parent: spec.categoryId,
        userLimit: spec.userLimit,
        permissionOverwrites: overwrites,
        reason,
      });
      return created.id;
    }
    if (channel.name !== spec.name || channel.userLimit !== spec.userLimit) await channel.edit({ name: spec.name, userLimit: spec.userLimit, reason });
    // The room is the bot's own channel: a full replace converges it (unlike access channels).
    await channel.permissionOverwrites.set(overwrites, reason);
    return channel.id;
  }

  async checkRoomCategory(categoryId: string): Promise<RoomCategoryCheck> {
    const missing = await this.missing(categoryId, (c) => c.type === ChannelType.GuildCategory, VOICE_NEEDS);
    const guild = await this.guild();
    const channelCount = guild.channels.cache.filter((c) => c.parentId === categoryId).size;
    return { missing, channelCount };
  }

  async disconnect(userId: string, channelId: string): Promise<void> {
    if (isFakeUserId(userId)) return;
    const guild = await this.guild();
    try {
      const member = await guild.members.fetch(userId);
      if (member.voice.channelId === channelId) await member.voice.disconnect('KiberPride Bot: removed from a personal room');
    } catch {
      // best effort: a guest who left voice or the server is out anyway
    }
  }

  // ─── Earnings (014 §6) and private messages (014 §4) ──────────────────────

  async voiceSnapshot(): Promise<VoiceSnapshot> {
    const guild = await this.guild();
    const byChannel = new Map<string, VoiceMemberState[]>();
    for (const state of guild.voiceStates.cache.values()) {
      if (!state.channelId) continue;
      const list = byChannel.get(state.channelId) ?? [];
      list.push({
        userId: state.id,
        bot: state.member?.user.bot ?? this.client.users.cache.get(state.id)?.bot ?? false,
        selfDeaf: state.selfDeaf === true,
        serverDeaf: state.serverDeaf === true,
      });
      byChannel.set(state.channelId, list);
    }
    return {
      afkChannelId: guild.afkChannelId,
      channels: [...byChannel].map(([id, members]) => ({ id, stage: guild.channels.cache.get(id)?.type === ChannelType.GuildStageVoice, members })),
    };
  }

  async sendDm(userId: string, notice: PlayerNotice): Promise<'sent' | 'refused'> {
    if (isFakeUserId(userId)) return 'refused';
    try {
      await this.client.users.send(userId, { embeds: [playerNoticeEmbed(notice)] });
      return 'sent';
    } catch (err) {
      if (hasCode(err, RESTJSONErrorCodes.CannotSendMessagesToThisUser) || hasCode(err, RESTJSONErrorCodes.UnknownUser)) return 'refused';
      throw err;
    }
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private async roleById(guild: Guild, id: string): Promise<Role | null> {
    const cached = guild.roles.cache.get(id);
    if (cached) return cached;
    return guild.roles.fetch(id).catch((err: unknown) => {
      if (hasCode(err, RESTJSONErrorCodes.UnknownRole)) return null;
      throw err;
    });
  }

  private async channelById(guild: Guild, id: string): Promise<GuildBasedChannel | null> {
    return guild.channels.fetch(id).catch((err: unknown) => {
      if (isUnknown(err)) return null;
      throw err;
    });
  }

  private async missing(
    id: string,
    isRightKind: (c: GuildBasedChannel) => boolean,
    needs: readonly (keyof typeof PermissionFlagsBits)[],
  ): Promise<MissingPermissions> {
    const guild = await this.guild();
    const channel = await guild.channels.fetch(id).catch((err: unknown) => {
      if (isUnknown(err)) return null;
      throw err;
    });
    if (!channel || !isRightKind(channel)) return ['NotFound'];
    const me = guild.members.me ?? (await guild.members.fetchMe());
    const held = channel.permissionsFor(me);
    return needs.filter((flag) => !held.has(PermissionFlagsBits[flag]));
  }

  /** Full replace (008 §7): @everyone out, the bot in, organisers and the team in. */
  private teamOverwrites(guild: Guild, spec: VoiceChannelSpec): OverwriteResolvable[] {
    const allow = (id: string, type: OverwriteType, perms: PermissionResolvable): OverwriteResolvable => ({ id, type, allow: perms });
    // A deleted role still named in RoleCapability would make Discord refuse the whole overwrite
    // set, and the channel would never open (review 2026-09-20).
    const { kept, dropped } = knownRoleIds(spec.allowRoleIds, (id) => guild.roles.cache.has(id));
    if (dropped.length > 0) this.log?.warn({ dropped, channel: spec.name }, 'team channel: roles no longer on the server left out of the overwrites');
    return [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: SEE_AND_JOIN },
      allow(this.botId(), OverwriteType.Member, BOT_IN_TEAM_CHANNEL),
      ...kept.map((id) => allow(id, OverwriteType.Role, SEE_AND_JOIN)),
      ...real(spec.allowUserIds).map((id) => allow(id, OverwriteType.Member, SEE_AND_JOIN)),
    ];
  }

  private botId(): string {
    const id = this.client.user?.id;
    if (!id) throw new Error('gateway used before the client is ready');
    return id;
  }

  private async guild(): Promise<Guild> {
    if (!this.binding.id) throw new Error('no guild bound yet');
    return this.client.guilds.fetch(this.binding.id);
  }
}

/** Splits role ids into those the guild still has and those it does not. */
export function knownRoleIds(ids: readonly string[], exists: (id: string) => boolean): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of ids) (exists(id) ? kept : dropped).push(id);
  return { kept, dropped };
}

function isUnknown(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel;
}

function hasCode(err: unknown, code: RESTJSONErrorCodes): boolean {
  return err instanceof DiscordAPIError && err.code === code;
}
