// The Discord client and the one guild it serves (decision 002 §6). The owner never copies
// ids: DISCORD_GUILD_ID is optional — with it unset the bot serves the single guild it is in.
import { Client, GatewayIntentBits, type Guild } from 'discord.js';
import type { LoggingService } from '../modules/logging/service.js';
import { commandDefinitions } from './commands/index.js';
import { recover } from './recovery.js';
import type { AppContext } from './router.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // privileged: a player leaving the server (decision 004 §5)
      GatewayIntentBits.GuildVoiceStates, // moving players into team channels
    ],
  });
}

export type GuildChoice =
  | { kind: 'ok'; guildId: string }
  | { kind: 'none' } // the bot is in no guild yet: the owner has not opened the invite link
  | { kind: 'absent'; guildId: string } // DISCORD_GUILD_ID is set but the bot is not there
  | { kind: 'ambiguous'; guildIds: string[] }; // several guilds and nothing says which

export function chooseGuild(configured: string | undefined, joined: readonly string[]): GuildChoice {
  if (configured) return joined.includes(configured) ? { kind: 'ok', guildId: configured } : { kind: 'absent', guildId: configured };
  if (joined.length === 0) return { kind: 'none' };
  if (joined.length === 1) return { kind: 'ok', guildId: joined[0] as string };
  return { kind: 'ambiguous', guildIds: [...joined] };
}

export interface BindDeps {
  ctx: AppContext;
  logging: LoggingService;
  version: string;
  inviteUrl: string | null;
}

/**
 * Chooses the guild and, when there is one, serves it: registers the slash commands, makes sure
 * the log channel exists, posts the heartbeat, runs recovery. Safe to call again (guildCreate).
 */
export async function bindGuild(client: Client, configured: string | undefined, deps: BindDeps): Promise<void> {
  const { ctx } = deps;
  if (ctx.guild.id !== null) return;

  const choice = chooseGuild(configured, [...client.guilds.cache.keys()]);
  const invite = deps.inviteUrl ?? '(npm run invite-link)';
  switch (choice.kind) {
    case 'none':
      ctx.logger.warn({ invite }, 'bot is in no guild yet — open the invite link');
      return;
    case 'absent':
      ctx.logger.error(
        { guildId: choice.guildId, invite },
        'DISCORD_GUILD_ID is set but the bot is not in that guild — open the invite link',
      );
      return;
    case 'ambiguous':
      ctx.logger.error(
        { guildIds: choice.guildIds },
        'bot is in several guilds and DISCORD_GUILD_ID is not set — refusing to serve any; set DISCORD_GUILD_ID',
      );
      return;
    case 'ok':
      break;
  }

  // Bound before the first await, so a guildCreate racing the ready event cannot bind twice.
  ctx.guild.id = choice.guildId;
  const guild = await client.guilds.fetch(choice.guildId);
  ctx.logger.info({ guildId: guild.id, guildName: guild.name, fromEnv: Boolean(configured) }, 'serving guild');
  await registerCommands(guild, ctx);

  try {
    await deps.logging.ensureLogChannel();
  } catch (err) {
    ctx.logger.error({ err }, 'could not ensure the log channel (does the bot have Manage Channels?)');
  }
  await deps.logging.heartbeat(deps.version);
  await recover(ctx);
}

async function registerCommands(guild: Guild, ctx: AppContext): Promise<void> {
  // Guild commands update instantly; `set` replaces the whole list, so it is idempotent.
  const registered = await guild.commands.set(commandDefinitions);
  ctx.logger.info({ commands: [...registered.values()].map((c) => c.name) }, 'slash commands registered');
}
