// Gateway event listeners. Thin: each one calls into client.ts / the router / a service.
import { Events, type Client } from 'discord.js';
import { systemClock, type Clock } from '../../core/clock.js';
import { bindGuild, type BindDeps } from '../client.js';
import { createDropTracker, restoredLine } from '../connection.js';
import { dispatch, type Routes } from '../router.js';

export interface EventDeps extends BindDeps {
  routes: Routes;
  configuredGuildId: string | undefined;
  /** Logs and ends the process (exit 1) so the container restarts it clean. */
  fatal: (err: unknown, why: string) => void;
  clock?: Clock;
}

export function registerEvents(client: Client, deps: EventDeps): void {
  const { ctx } = deps;
  const clock = deps.clock ?? systemClock;
  const drops = createDropTracker();

  // A bind that threw half-way leaves ctx.guild.id set with no commands or recovery, and no
  // later guildCreate retries it — so it ends the process instead (rule bot-always-on §4).
  // «No guild yet» is not a throw: bindGuild returns and waits for guildCreate.
  const bind = () => {
    bindGuild(client, deps.configuredGuildId, deps).catch((err: unknown) => deps.fatal(err, 'guild setup failed'));
  };

  client.once(Events.ClientReady, (ready) => {
    ctx.logger.info({ user: ready.user.tag, version: deps.version, guilds: ready.guilds.cache.size }, 'ready');
    bind();
  });

  // The owner opened the invite link while the bot was running: serve that guild now.
  client.on(Events.GuildCreate, (guild) => {
    ctx.logger.info({ guildId: guild.id, guildName: guild.name }, 'joined a guild');
    bind();
  });

  // A player left the server: open recruitments and matches follow decision 004 §5.
  client.on(Events.GuildMemberRemove, (member) => {
    if (member.guild.id !== ctx.guild.id) return;
    ctx.matches.memberLeft(member.id).catch((err: unknown) => ctx.logger.error({ err, userId: member.id }, 'memberLeft failed'));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    dispatch(interaction, deps.routes, ctx).catch((err: unknown) => ctx.logger.error({ err }, 'dispatch failed'));
  });

  // Drops are timed so the log channel learns of an outage once it is over (it cannot be
  // posted to while Discord is unreachable). A long outage is ended by the watchdog in main.ts.
  client.on(Events.ShardDisconnect, (event, shardId) => {
    drops.dropped(shardId, clock.now());
    ctx.logger.warn({ shardId, code: event.code }, 'gateway disconnected');
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    drops.dropped(shardId, clock.now());
    ctx.logger.warn({ shardId }, 'gateway reconnecting');
  });
  const restored = (shardId: number, how: string) => {
    ctx.logger.info({ shardId }, `gateway ${how}`);
    const downMs = drops.restored(shardId, clock.now());
    if (downMs === null) return;
    void deps.logging.event('gateway_restored', { shardId, downMs, how }, restoredLine(downMs));
  };
  client.on(Events.ShardResume, (shardId) => restored(shardId, 'resumed'));
  client.on(Events.ShardReady, (shardId) => restored(shardId, 'ready'));
  client.on(Events.Error, (err) => ctx.logger.error({ err }, 'discord client error'));
}
