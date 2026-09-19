// Decision 014 §3.1 (Rejected): `permissionOverwrites.set` on an access channel would wipe the
// server's own overwrites. The fake manager below throws on `set`, so any path that reaches it
// fails this test.
import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { clearAccessOverwrites, otherRolesAllowing, writeAccessOverwrites, type OverwritesLike } from './accessOverwrites.js';

const T = { everyoneId: '100', botId: '200', roleId: '300' };
const bits = (...flags: (keyof typeof PermissionFlagsBits)[]) => {
  const value = flags.reduce((acc, f) => acc | PermissionFlagsBits[f], 0n);
  return { has: (bit: bigint) => (value & bit) === bit };
};

function manager(existing: { id: string; type: OverwriteType; allow: ReturnType<typeof bits> }[] = []) {
  const calls: string[] = [];
  const cache = new Map(existing.map((o) => [o.id, o]));
  const ow: OverwritesLike & { set: () => never } = {
    cache,
    edit(target, options, extra) {
      calls.push(`edit ${target} ${extra.type === OverwriteType.Member ? 'member' : 'role'} ${JSON.stringify(options)}`);
      return Promise.resolve();
    },
    delete(target) {
      calls.push(`delete ${target}`);
      return Promise.resolve();
    },
    set() {
      throw new Error('permissionOverwrites.set must never be called on an access channel');
    },
  };
  return { ow, calls };
}

describe('access channel overwrites (014 §3.1)', () => {
  it('writes one target at a time with edit: the bot keeps the permissions first, then the role, then @everyone', async () => {
    const { ow, calls } = manager([{ id: '999', type: OverwriteType.Role, allow: bits('ManageMessages') }]);
    await writeAccessOverwrites(ow, T, ['AttachFiles', 'EmbedLinks'], 'test');
    expect(calls).toEqual([
      'edit 200 member {"AttachFiles":true,"EmbedLinks":true}',
      'edit 300 role {"AttachFiles":true,"EmbedLinks":true}',
      'edit 100 role {"AttachFiles":false,"EmbedLinks":false}',
    ]);
    expect(ow.cache.has('999')).toBe(true); // the server's own overwrite is untouched
  });

  it('a channel taken off the list: the role overwrite deleted, @everyone and the bot back to inherit', async () => {
    const { ow, calls } = manager([
      { id: '300', type: OverwriteType.Role, allow: bits('AttachFiles') },
      { id: '100', type: OverwriteType.Role, allow: bits() },
      { id: '200', type: OverwriteType.Member, allow: bits('AttachFiles') },
    ]);
    await clearAccessOverwrites(ow, T, ['AttachFiles', 'EmbedLinks'], 'test');
    expect(calls).toEqual([
      'delete 300',
      'edit 100 role {"AttachFiles":null,"EmbedLinks":null}',
      'edit 200 member {"AttachFiles":null,"EmbedLinks":null}',
    ]);
  });

  it('warns about other roles that allow a granted permission, not about ours or @everyone', () => {
    const { ow } = manager([
      { id: '300', type: OverwriteType.Role, allow: bits('AttachFiles') },
      { id: '100', type: OverwriteType.Role, allow: bits('EmbedLinks') },
      { id: '400', type: OverwriteType.Role, allow: bits('EmbedLinks') },
      { id: '500', type: OverwriteType.Role, allow: bits('SendMessages') },
      { id: '600', type: OverwriteType.Member, allow: bits('AttachFiles') },
    ]);
    expect(otherRolesAllowing(ow, T, ['AttachFiles', 'EmbedLinks'])).toEqual(['400']);
  });
});
