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
  /** Ensures the log channel exists (creating it if missing or deleted) and stores its id. */
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

  async function post(line: string): Promise<void> {
    try {
      await audit.post(line);
    } catch (err) {
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

    async ensureLogChannel() {
      const current = (await settings.get()).logChannelId;
      const id = await gateway.ensureLogChannel(current);
      if (id !== current) {
        await settings.update({ logChannelId: id });
        logger.info({ logChannelId: id, previous: current }, 'log channel created');
      }
      return id;
    },

    async heartbeat(version) {
      logger.info({ version }, 'heartbeat');
      await post(`✅ Бот запущен · версия ${version}`);
    },
  };
}
