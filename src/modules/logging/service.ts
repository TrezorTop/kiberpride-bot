// Every important action is logged twice: pino and the Discord log channel (rule
// bot-always-on §3). A failure to post to Discord is logged by pino and never breaks the caller.
import type { AuditLog, GuildGateway } from '../../core/ports.js';
import type { SettingsService } from '../settings/service.js';
import type { Logger } from './logger.js';

export interface LoggingService {
  /** Structured event: pino always; the log channel when `audit` text is given. */
  event(name: string, fields: Record<string, unknown>, audit?: string): Promise<void>;
  /** Same as `event`, at error level: something failed and someone should look (sync, jobs). */
  failure(name: string, fields: Record<string, unknown>, audit?: string): Promise<void>;
  /**
   * Ensures the log channel exists (creating it when missing, deleted, or left in a guild this
   * deployment no longer serves) and stores its id. Cheap to call again; a failure is retried by
   * the next log event, so the heartbeat never depends on it (rule bot-always-on §4).
   */
  ensureLogChannel(): Promise<string>;
  /** The quiet «alive» line on start, carrying the version (rule bot-always-on §4). */
  heartbeat(version: string): Promise<void>;
}

export function createLoggingService(deps: {
  logger: Logger;
  settings: SettingsService;
  gateway: GuildGateway;
  audit: AuditLog;
}): LoggingService {
  const { logger, settings, gateway, audit } = deps;

  // One ensure at a time (two events at once must not create two channels), kept so later posts
  // are free, and forgotten whenever a post fails — so a channel deleted, or left behind in the
  // guild the bot no longer serves, is retried on the next event instead of once at bind.
  let ensured: Promise<string> | null = null;

  function ensureOnce(): Promise<string> {
    ensured ??= doEnsure().catch((err: unknown) => {
      ensured = null;
      throw err;
    });
    return ensured;
  }

  async function doEnsure(): Promise<string> {
    const current = (await settings.get()).logChannelId;
    const id = await gateway.ensureLogChannel(current);
    if (id !== current) {
      await settings.update({ logChannelId: id });
      logger.info({ logChannelId: id, previous: current }, 'log channel created');
    }
    return id;
  }

  async function post(line: string): Promise<void> {
    try {
      await ensureOnce();
      await audit.post(line);
    } catch (err) {
      ensured = null; // the next event ensures again rather than posting into nothing
      logger.warn({ err }, 'log channel post failed');
    }
  }

  return {
    async event(name, fields, auditLine) {
      logger.info({ event: name, ...fields }, name);
      if (auditLine) await post(auditLine);
    },

    async failure(name, fields, auditLine) {
      logger.error({ event: name, ...fields }, name);
      if (auditLine) await post(auditLine);
    },

    ensureLogChannel: ensureOnce,

    async heartbeat(version) {
      logger.info({ version }, 'heartbeat');
      await post(`✅ Бот запущен · версия ${version}`);
    },
  };
}
