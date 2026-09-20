// The rule behind «the stored id is not there» (2026-09-20: the bot moved guild and its stored
// log channel answered 50001, which no path recognised).
import { DiscordAPIError, DiscordjsError, DiscordjsErrorCodes, RESTJSONErrorCodes } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { belongsToGuild, isMissing } from './missing.js';

const GUILD = '100000000000000001';
const OTHER = '100000000000000002';

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError({ code, message: 'x' }, code, 404, 'GET', 'https://discord.test', {});
}

/** discord.js marks its own constructor private; at runtime it is an ordinary class. */
const DjsError = DiscordjsError as unknown as new (code: DiscordjsErrorCodes) => DiscordjsError;

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

  // The foreign-id case the 50001 rule alone misses: while the bot is still in the other guild,
  // `guild.channels.fetch(<other guild's id>)` succeeds against the API and discord.js itself
  // refuses the result with GuildChannelUnowned — not a DiscordAPIError at all.
  it('covers discord.js own GuildChannelUnowned: a fetched channel of another guild', () => {
    const err = new DjsError(DiscordjsErrorCodes.GuildChannelUnowned);
    expect(err).not.toBeInstanceOf(DiscordAPIError); // otherwise the 50001 rule would have caught it
    expect(isMissing(err)).toBe(true);
  });

  it('does not swallow another DiscordjsError: only GuildChannelUnowned means «not there»', () => {
    expect(isMissing(new DjsError(DiscordjsErrorCodes.GuildVoiceChannelResolve))).toBe(false);
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
