// Implements the domain ports on top of discord.js (decision 002 §2). Every method is
// idempotent: a replay after a crash must leave the same Discord state, never a duplicate.
import { ChannelType, DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes, type Client, type Guild } from 'discord.js';
import type { AuditLog, GuildGateway } from '../core/ports.js';
import type { GuildBinding } from './router.js';

export const LOG_CHANNEL_NAME = 'kp-логи';

export class DiscordGateway implements GuildGateway, AuditLog {
  private logChannelId: string | null = null;

  constructor(
    private readonly client: Client,
    private readonly binding: GuildBinding,
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

    const botId = this.client.user?.id;
    if (!botId) throw new Error('ensureLogChannel before the client is ready');
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
    await channel.send({ content: line, allowedMentions: { parse: [] } });
  }

  private async guild(): Promise<Guild> {
    if (!this.binding.id) throw new Error('no guild bound yet');
    return this.client.guilds.fetch(this.binding.id);
  }
}

function isUnknown(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel;
}
