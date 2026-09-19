import { describe, expect, it } from 'vitest';
import { parseEnv, resolveVersion } from './env.js';

const TOKEN = 'x'.repeat(72);
const base = { DISCORD_TOKEN: TOKEN, DATABASE_URL: 'postgresql://kiber:kiber@localhost:5432/kiberpride' };

describe('env', () => {
  it('needs only the token and the database', () => {
    const env = parseEnv(base);
    expect(env.DISCORD_CLIENT_ID).toBeUndefined();
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
  });

  it('treats empty optional lines in .env as unset', () => {
    const env = parseEnv({ ...base, DISCORD_CLIENT_ID: '', DISCORD_GUILD_ID: '  ', APP_VERSION: '' });
    expect(env.DISCORD_CLIENT_ID).toBeUndefined();
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
    expect(env.APP_VERSION).toBeUndefined();
  });

  it('rejects a malformed guild id', () => {
    expect(() => parseEnv({ ...base, DISCORD_GUILD_ID: 'my-server' })).toThrow(/DISCORD_GUILD_ID/);
  });

  it('names a missing token without printing any value', () => {
    let message = '';
    try {
      parseEnv({ DATABASE_URL: base.DATABASE_URL, DISCORD_TOKEN: 'short-secret' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/DISCORD_TOKEN/);
    expect(message).not.toContain('short-secret');
  });

  it('prefers the baked APP_VERSION', () => {
    expect(resolveVersion({ APP_VERSION: 'abc1234' })).toBe('abc1234');
  });
});
