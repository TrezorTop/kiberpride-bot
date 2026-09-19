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
import { startGrantsJob } from './jobs/grants.js';
import { startRecruitTimeoutJob } from './jobs/recruitTimeout.js';
import { startSyncRetryJob } from './jobs/syncRetry.js';
import { startVoiceJob } from './jobs/voice.js';
import { createEarningsService } from './modules/earnings/service.js';
import { createEconomyService } from './modules/economy/service.js';
import { createGamesService } from './modules/games/service.js';
import { createLogger } from './modules/logging/logger.js';
import { createLoggingService } from './modules/logging/service.js';
import { createMatchesService } from './modules/matches/service.js';
import { createPermissionsService, dbCapabilitySource, dbRoleSource } from './modules/permissions/service.js';
import { createRewardsService } from './modules/rewards/service.js';
import { createSettingsService } from './modules/settings/service.js';
import { createClanService } from './modules/shop/clan.js';
import { createRoomService } from './modules/shop/room.js';
import { createShopService } from './modules/shop/service.js';

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
  const gateway = new DiscordGateway(client, binding, logger);

  const settings = createSettingsService(db);
  const logging = createLoggingService({ logger, settings, gateway, audit: gateway });
  const economy = createEconomyService(db);
  const permissions = createPermissionsService(dbCapabilitySource(db), dbRoleSource(db));
  const games = createGamesService(db);
  const rewards = createRewardsService(db);
  const matches = createMatchesService({
    db,
    economy,
    rewards,
    games,
    permissions,
    settings,
    logging,
    gateway,
    nodeEnv: env.NODE_ENV,
    clock: systemClock,
  });
  const shop = createShopService({ db, economy, permissions, logging, gateway, nodeEnv: env.NODE_ENV, clock: systemClock });
  const clans = createClanService({ db, shop, logging, gateway, clock: systemClock });
  const rooms = createRoomService({ db, shop, logging, gateway, clock: systemClock });
  const earnings = createEarningsService({ db, economy, settings, logging, clock: systemClock });
  const ctx: AppContext = {
    economy,
    permissions,
    settings,
    games,
    rewards,
    matches,
    shop,
    clans,
    rooms,
    earnings,
    gateway,
    logging,
    logger,
    guild: binding,
    nodeEnv: env.NODE_ENV,
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

  // Decision 009 §5: unfilled recruitments close after GuildSettings.recruitTimeoutHours.
  const stopRecruitTimeout = startRecruitTimeoutJob({
    settings,
    matches,
    logging,
    clock: systemClock,
    isReady: () => binding.id !== null && isConnected(client),
  });

  // A failed sync is retried every minute, not only on the next change or restart.
  const stopSyncRetry = startSyncRetryJob({
    matches,
    logging,
    isReady: () => binding.id !== null && isConnected(client),
  });

  // Decision 014 §4: warnings, expiry, retries and refunds of shop grants.
  const stopGrants = startGrantsJob({
    shop,
    logging,
    clock: systemClock,
    isReady: () => binding.id !== null && isConnected(client),
  });

  // Decision 014 §6: one minute of voice time for every eligible player.
  const stopVoice = startVoiceJob({
    gateway,
    earnings,
    logging,
    clock: systemClock,
    isReady: () => binding.id !== null && isConnected(client),
  });

  const health = startHealthServer(async () => {
    if (!isConnected(client)) return false;
    await db.$queryRaw`SELECT 1`;
    return true;
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopWatchdog();
    stopRecruitTimeout();
    stopSyncRetry();
    stopGrants();
    stopVoice();
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
