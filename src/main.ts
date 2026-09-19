// Composition root (decision 002 §1): parse the environment, wire the services, start Discord,
// serve the health check. Nothing else lives here.
import { createServer, type Server } from 'node:http';
import { config as loadDotenv } from 'dotenv';
import { parseEnv, resolveVersion } from './config/env.js';
import { systemClock } from './core/clock.js';
import { createDb } from './db/client.js';
import { buttons } from './discord/buttons/index.js';
import { createClient } from './discord/client.js';
import { commands } from './discord/commands/index.js';
import { isConnected, startWatchdog } from './discord/connection.js';
import { registerEvents } from './discord/events/index.js';
import { DiscordGateway } from './discord/gateway.js';
import { clientIdFromToken, inviteUrl } from './discord/invite.js';
import { modals } from './discord/modals/index.js';
import type { AppContext, GuildBinding } from './discord/router.js';
import { selects } from './discord/selects/index.js';
import { createEconomyService } from './modules/economy/service.js';
import { createLogger } from './modules/logging/logger.js';
import { createLoggingService } from './modules/logging/service.js';
import { createPermissionsService, dbCapabilitySource } from './modules/permissions/service.js';
import { createSettingsService } from './modules/settings/service.js';

/** Container health check target (deploy/docker-compose.yml); bound to localhost only. */
const HEALTH_PORT = 8080;
const WATCHDOG_MAX_DISCONNECTED_MS = 5 * 60_000;
const WATCHDOG_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  loadDotenv({ quiet: true }); // local runs; on the server compose passes the environment
  const env = parseEnv();
  const version = resolveVersion(env);
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });
  logger.info({ version, nodeEnv: env.NODE_ENV }, 'starting');

  const db = createDb(env.DATABASE_URL);
  const client = createClient();
  const binding: GuildBinding = { id: null };
  const gateway = new DiscordGateway(client, binding);

  const settings = createSettingsService(db);
  const logging = createLoggingService({ logger, settings, gateway, audit: gateway });
  const ctx: AppContext = {
    economy: createEconomyService(db),
    permissions: createPermissionsService(dbCapabilitySource(db)),
    logging,
    logger,
    guild: binding,
  };

  // A process that cannot serve ends with exit 1; `restart: unless-stopped` brings up a clean one.
  const fatal = (err: unknown, why: string) => {
    logger.fatal({ err }, `${why} — exiting so the process is restarted clean`);
    process.exit(1);
  };

  const clientId = env.DISCORD_CLIENT_ID ?? clientIdFromToken(env.DISCORD_TOKEN);
  registerEvents(client, {
    ctx,
    logging,
    version,
    inviteUrl: clientId ? inviteUrl(clientId) : null,
    routes: { commands, buttons, selects, modals },
    configuredGuildId: env.DISCORD_GUILD_ID,
    fatal,
  });

  // discord.js reconnects by itself; this catches the case where it never manages to (rule
  // bot-always-on §4). Counts from start too, so a login that never completes is caught as well.
  const stopWatchdog = startWatchdog({
    isConnected: () => isConnected(client),
    clock: systemClock,
    maxDisconnectedMs: WATCHDOG_MAX_DISCONNECTED_MS,
    intervalMs: WATCHDOG_INTERVAL_MS,
    onStuck: (ms) => fatal(null, `no Discord connection for ${Math.round(ms / 60_000)} min`),
  });

  const health = startHealthServer(async () => {
    if (!isConnected(client)) return false;
    await db.$queryRaw`SELECT 1`;
    return true;
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopWatchdog();
    health.close();
    void client
      .destroy()
      .then(() => db.$disconnect())
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  await client.login(env.DISCORD_TOKEN);
}

function startHealthServer(check: () => Promise<boolean>): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    check()
      .then((ok) => res.writeHead(ok ? 200 : 503).end(ok ? 'ok' : 'not ready'))
      .catch(() => res.writeHead(503).end('db unreachable'));
  });
  server.listen(HEALTH_PORT, '127.0.0.1');
  return server;
}

main().catch((err: unknown) => {
  // The logger may not exist yet (bad environment); stderr carries no secret values.
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  if (/disallowed intents/i.test(message)) {
    console.error('Turn on «Server Members Intent» in the developer portal (runbooks/discord-app-setup.md §1.3).');
  }
  process.exit(1);
});
