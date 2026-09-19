// The rule behind «the stored id is not there» (2026-09-20: the bot moved guild and its stored
// log channel answered 50001, which no path recognised).
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { belongsToGuild, isMissing } from './missing.js';

const GUILD = '100000000000000001';
const OTHER = '100000000000000002';

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: 'x' }, code, 404, 'GET', 'https://discord.test', {});
}

describe('isMissing', () => {
  it('covers deleted ids, an unknown guild, and the 50001 a guild we no longer serve returns', () => {
    for (const code of [
      RESTJSONErrorCodes.UnknownChannel,
      RESTJSONErrorCodes.UnknownGuild,
      RESTJSONErrorCodes.UnknownRole,
      RESTJSONErrorCodes.MissingAccess,
    ]) {
      expect(isMissing(apiError(code))).toBe(true);
    }
  });

  it('does NOT cover 50013: the object is there and visible, and forgetting its id would leak it', () => {
    expect(isMissing(apiError(RESTJSONErrorCodes.MissingPermissions))).toBe(false);
  });

  it('does not swallow anything else: a rate limit or a network failure must still throw', () => {
    expect(isMissing(apiError(RESTJSONErrorCodes.UnknownMessage))).toBe(false);
    expect(isMissing(apiError(RESTJSONErrorCodes.UnknownMember))).toBe(false);
    expect(isMissing(new Error('socket hang up'))).toBe(false);
    expect(isMissing(null)).toBe(false);
    expect(isMissing({ code: RESTJSONErrorCodes.MissingAccess })).toBe(false); // not a DiscordAPIError
  });
});

describe('belongsToGuild', () => {
  it('reads guildId (channels) and guild.id (roles)', () => {
    expect(belongsToGuild({ guildId: GUILD }, GUILD)).toBe(true);
    expect(belongsToGuild({ guild: { id: GUILD } }, GUILD)).toBe(true);
    expect(belongsToGuild({ guildId: OTHER }, GUILD)).toBe(false);
    expect(belongsToGuild({ guild: { id: OTHER } }, GUILD)).toBe(false);
  });

  it('treats anything it cannot place as foreign — one re-creation costs less than a stale id', () => {
    expect(belongsToGuild(null, GUILD)).toBe(false);
    expect(belongsToGuild(undefined, GUILD)).toBe(false);
    expect(belongsToGuild({ id: GUILD }, GUILD)).toBe(false);
    expect(belongsToGuild({ guildId: null, guild: null }, GUILD)).toBe(false);
    expect(belongsToGuild('channel', GUILD)).toBe(false);
  });
});
