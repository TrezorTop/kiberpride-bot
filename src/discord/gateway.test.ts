import { ChannelType, Collection, DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { DiscordGateway, knownRoleIds, LOG_CHANNEL_NAME } from './gateway.js';

describe('team channel roles (review 2026-09-20)', () => {
  it('keeps the roles the guild still has, in order, and names the rest', () => {
    const guild = new Set(['600000000000000001', '600000000000000003']);
    expect(knownRoleIds(['600000000000000001', '600000000000000002', '600000000000000003'], (id) => guild.has(id))).toEqual({
      kept: ['600000000000000001', '600000000000000003'],
      dropped: ['600000000000000002'],
    });
    expect(knownRoleIds([], () => true)).toEqual({ kept: [], dropped: [] });
  });
});

const GUILD = '100000000000000001';

interface FakeChannel {
  id: string;
  name: string;
  type: ChannelType;
}

/** Just enough of discord.js for `ensureLogChannel`: fetch by id, fetch all, create. */
function fakeClient(channels: readonly FakeChannel[]) {
  const all = new Collection<string, FakeChannel>(channels.map((c) => [c.id, c]));
  const created: FakeChannel[] = [];
  const guild = {
    id: GUILD,
    roles: { everyone: { id: GUILD } },
    channels: {
      fetch: (id?: string) => {
        if (id === undefined) return Promise.resolve(all);
        const found = all.get(id);
        if (!found) {
          const code = RESTJSONErrorCodes.UnknownChannel;
          return Promise.reject(new DiscordAPIError({ code, message: 'Unknown Channel' }, code, 404, 'GET', 'https://discord.test', {}));
        }
        return Promise.resolve({ ...found, guildId: GUILD });
      },
      create: (options: { name: string }) => {
        const channel: FakeChannel = { id: `90000000000000000${created.length}`, name: options.name, type: ChannelType.GuildText };
        created.push(channel);
        all.set(channel.id, channel);
        return Promise.resolve(channel);
      },
    },
  };
  return {
    created,
    gateway: new DiscordGateway(
      { guilds: { fetch: () => Promise.resolve(guild) }, user: { id: '200000000000000001' } } as unknown as Client,
      { id: GUILD },
    ),
  };
}

// Review 2026-09-20: with `channelById` answering null for a channel that exists (a stale id from
// the old guild, View taken away), «create when the id does not resolve» would leave the server
// with a new `kp-логи` after every such start. 008 §7: by id, then by name, then create.
describe('ensureLogChannel', () => {
  it('adopts the log channel the guild already has instead of creating a second one', async () => {
    const { gateway, created } = fakeClient([{ id: '400000000000000001', name: LOG_CHANNEL_NAME, type: ChannelType.GuildText }]);
    expect(await gateway.ensureLogChannel('300000000000000009')).toBe('400000000000000001'); // stale id
    expect(await gateway.ensureLogChannel(null)).toBe('400000000000000001'); // nothing stored
    expect(created).toHaveLength(0);
  });

  it('keeps the stored channel when its id still resolves', async () => {
    const { gateway, created } = fakeClient([
      { id: '400000000000000001', name: LOG_CHANNEL_NAME, type: ChannelType.GuildText },
      { id: '400000000000000002', name: 'старые-логи', type: ChannelType.GuildText },
    ]);
    expect(await gateway.ensureLogChannel('400000000000000002')).toBe('400000000000000002');
    expect(created).toHaveLength(0);
  });

  it('creates one when the guild has no text channel by that name', async () => {
    const { gateway, created } = fakeClient([{ id: '400000000000000003', name: LOG_CHANNEL_NAME, type: ChannelType.GuildVoice }]);
    const id = await gateway.ensureLogChannel(null);
    expect(created.map((c) => c.name)).toEqual([LOG_CHANNEL_NAME]);
    expect(id).toBe(created[0]?.id);
  });
});
