import { describe, expect, it } from 'vitest';
import { chooseGuild } from './client.js';

const A = '100000000000000001';
const B = '100000000000000002';

describe('chooseGuild', () => {
  it('serves the only guild the bot is in when nothing is configured', () => {
    expect(chooseGuild(undefined, [A])).toEqual({ kind: 'ok', guildId: A });
  });

  it('waits for the invite when the bot is in no guild', () => {
    expect(chooseGuild(undefined, [])).toEqual({ kind: 'none' });
  });

  it('refuses to guess between several guilds', () => {
    expect(chooseGuild(undefined, [A, B])).toEqual({ kind: 'ambiguous', guildIds: [A, B] });
  });

  it('follows DISCORD_GUILD_ID when it is set', () => {
    expect(chooseGuild(B, [A, B])).toEqual({ kind: 'ok', guildId: B });
    expect(chooseGuild(B, [A])).toEqual({ kind: 'absent', guildId: B });
  });
});
