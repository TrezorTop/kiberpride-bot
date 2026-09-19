// pino to stdout. Pretty output only in development (pino-pretty is a dev dependency and is
// absent from the production image). Never log a token or a password (rule no-secrets-in-git).
import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(options: { level: string; pretty: boolean }): Logger {
  return pino({
    level: options.level,
    base: undefined,
    redact: { paths: ['token', '*.token', 'DISCORD_TOKEN', '*.DISCORD_TOKEN', 'password', '*.password'], censor: '[redacted]' },
    ...(options.pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
  });
}
