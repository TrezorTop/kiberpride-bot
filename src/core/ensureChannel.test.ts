// The ensure-by-id-then-name algorithm (decision 008 §7) against the fake gateway, which runs
// exactly these steps. The case added on 2026-09-20: the stored id belongs to the guild the bot
// used to serve, so `byId` must answer «not there» and a channel must be created here instead.
import { describe, expect, it } from 'vitest';
import { FakeGateway } from '../../tests/fakes/gateway.js';

const CATEGORY = '700000000000000001';
const ORGANISER = '300000000000000001';

const spec = (currentId: string | null) => ({
  categoryId: CATEGORY,
  name: '🔵 Команда A · #7',
  currentId,
  allowUserIds: [ORGANISER],
  allowRoleIds: [],
});

describe('ensureVoiceChannel when the stored id is another guild’s', () => {
  it('creates a new channel and does not adopt or delete the old guild’s one', async () => {
    const gw = new FakeGateway();
    const stale = gw.addForeignChannel('🔵 Команда A · #7', CATEGORY);

    const id = await gw.ensureVoiceChannel(spec(stale));

    expect(id).not.toBe(stale);
    expect(gw.created).toEqual([id]);
    expect(gw.channels.has(stale)).toBe(true); // still there, in the guild we no longer serve
    await gw.deleteChannel(stale);
    expect(gw.deleted).toEqual([]); // not ours to delete

    // And the ensure is idempotent from here: the new id is found, nothing else is created.
    expect(await gw.ensureVoiceChannel(spec(id))).toBe(id);
    expect(await gw.ensureVoiceChannel(spec(null))).toBe(id); // adopted by name, in this guild
    expect(gw.created).toEqual([id]);
  });

  it('never adopts a same-named channel from the old guild by name either', async () => {
    const gw = new FakeGateway();
    gw.addForeignChannel('🔵 Команда A · #7', CATEGORY);

    const id = await gw.ensureVoiceChannel(spec(null));

    expect(gw.created).toEqual([id]);
    expect(await gw.listVoiceChannels([CATEGORY])).toEqual([{ id, name: '🔵 Команда A · #7', parentId: CATEGORY }]);
  });
});
