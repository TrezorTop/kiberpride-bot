// Gateway event listeners. Thin: each one calls into client.ts / the router / a service.
import { Events, type Client } from 'discord.js';
import { bindGuild, type BindDeps } from '../client.js';
import { dispatch, type Routes } from '../router.js';

export function registerEvents(client: Client, deps: BindDeps & { routes: Routes; configuredGuildId: string | undefined }): void {
  const { ctx } = deps;

  client.once(Events.ClientReady, (ready) => {
    ctx.logger.info({ user: ready.user.tag, version: deps.version, guilds: ready.guilds.cache.size }, 'ready');
    bindGuild(client, deps.configuredGuildId, deps).catch((err: unknown) => ctx.logger.error({ err }, 'guild setup failed'));
  });

  // The owner opened the invite link while the bot was running: serve that guild now.
  client.on(Events.GuildCreate, (guild) => {
    ctx.logger.info({ guildId: guild.id, guildName: guild.name }, 'joined a guild');
    bindGuild(client, deps.configuredGuildId, deps).catch((err: unknown) => ctx.logger.error({ err }, 'guild setup failed'));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    dispatch(interaction, deps.routes, ctx).catch((err: unknown) => ctx.logger.error({ err }, 'dispatch failed'));
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    ctx.logger.warn({ shardId, code: event.code }, 'gateway disconnected');
  });
  client.on(Events.ShardReconnecting, (shardId) => ctx.logger.warn({ shardId }, 'gateway reconnecting'));
  client.on(Events.ShardResume, (shardId) => ctx.logger.info({ shardId }, 'gateway resumed'));
  client.on(Events.Error, (err) => ctx.logger.error({ err }, 'discord client error'));
}
