// Binding the database to a guild (2026-09-20 defect): the bot moved from the test guild to the
// real one and kept the old guild's log channel id, which Discord answered with «Missing Access»
// — the log channel was never ensured and the heartbeat never posted. The pass drops every
// stored Discord id when the served guild changes, and touches nothing else.
import { describe, expect, it } from 'vitest';
import { bindGuildSettings } from '../../../src/modules/settings/guildChange.js';
import { createSettingsService } from '../../../src/modules/settings/service.js';
import { guildIdsPatch } from '../../../src/modules/shop/kinds/index.js';
import { testDb } from '../helpers.js';

const OLD_GUILD = '100000000000000001';
const NEW_GUILD = '100000000000000002';
const LOG = '500000000000000001';
const PANEL = '500000000000000002';
const RECRUIT = '500000000000000003';
const CATEGORY = '500000000000000004';
const ACCESS_CHANNEL = '500000000000000005';
const ROLE = '600000000000000001';
const ANCHOR = '600000000000000002';
const PLAYER = '300000000000000001';

const db = testDb;
// Wired exactly as src/main.ts wires it: the shop tells settings where its Discord ids are.
const deps = () => ({ db: testDb(), settings: createSettingsService(testDb()), goodIdsPatch: guildIdsPatch });

/** The old guild's world: settings, three goods, and the things that must survive untouched. */
async function seedOldGuild(): Promise<{ channelGood: number; clanGood: number; roomGood: number; matchId: number }> {
  const { settings } = deps();
  await settings.update({
    guildId: OLD_GUILD,
    logChannelId: LOG,
    panelChannelId: PANEL,
    defaultRecruitChannelId: RECRUIT,
    defaultVoiceCategoryId: CATEGORY,
    recruitTimeoutHours: 6,
    dailyBonusAmount: 40,
  });

  const channelGood = await db().shopGood.create({
    data: {
      slug: 'images',
      name: 'Доступ к картинкам',
      description: '',
      price: 5000,
      kind: 'channel_permission',
      config: { permissions: ['AttachFiles'], channelIds: [ACCESS_CHANNEL], roleId: ROLE },
      enabled: true,
    },
  });
  const clanGood = await db().shopGood.create({
    data: { slug: 'clan', name: 'Клан', description: '', price: 9000, kind: 'clan_role', config: { maxMembers: 10, anchorRoleId: ANCHOR }, enabled: true },
  });
  const roomGood = await db().shopGood.create({
    data: { slug: 'room', name: 'Комната', description: '', price: 7000, kind: 'personal_room', config: { categoryId: CATEGORY }, enabled: true },
  });

  await db().user.create({ data: { id: PLAYER, balance: 120 } });
  await db().kpTransaction.create({
    data: { userId: PLAYER, amount: 120, balanceAfter: 120, kind: 'ADMIN_ADJUST', reference: 'admin:seed', description: 'seed' },
  });
  await db().roleCapability.create({ data: { roleId: ROLE, capability: 'ACTIVITY_CREATE' } });
  const game = await db().game.create({ data: { slug: 'cs2', name: 'CS2', emoji: '🔫', defaultTeamSize: 5 } });
  const match = await db().match.create({
    data: {
      gameId: game.id,
      title: 'CS2',
      teamSize: 5,
      capacity: 10,
      teamMode: 'AUTO',
      createdById: PLAYER,
      recruitChannelId: RECRUIT,
      recruitMessageId: '700000000000000001',
      voiceCategoryId: CATEGORY,
      voiceChannelAId: '700000000000000002',
      rewards: { participation: 25, win: 100, mvp: 50, draw: 0 },
    },
  });
  return { channelGood: channelGood.id, clanGood: clanGood.id, roomGood: roomGood.id, matchId: match.id };
}

const configOf = async (id: number) => (await db().shopGood.findUniqueOrThrow({ where: { id } })).config as Record<string, unknown>;

describe('bindGuildSettings', () => {
  it('records the guild on the first start and changes nothing else', async () => {
    const { settings } = deps();
    await settings.update({ logChannelId: LOG, defaultRecruitChannelId: RECRUIT });

    expect(await bindGuildSettings(deps(), NEW_GUILD)).toEqual({ kind: 'stored' });

    const after = await settings.get();
    expect(after.guildId).toBe(NEW_GUILD);
    // A healthy deployment upgrading in place must NOT lose its channels: ensureLogChannel has
    // no adopt-by-name path, so nulling a valid id would leave a second «kp-логи» behind.
    expect(after.logChannelId).toBe(LOG);
    expect(after.defaultRecruitChannelId).toBe(RECRUIT);
  });

  it('is a no-op on every later start with the same guild', async () => {
    await seedOldGuild();
    expect(await bindGuildSettings(deps(), OLD_GUILD)).toEqual({ kind: 'same' });
    expect((await deps().settings.get()).logChannelId).toBe(LOG);
  });

  it('drops every stored Discord id when the guild changes, and only those', async () => {
    const seeded = await seedOldGuild();

    expect(await bindGuildSettings(deps(), NEW_GUILD)).toEqual({ kind: 'changed', previousGuildId: OLD_GUILD, goodsCleared: 3 });

    const after = await deps().settings.get();
    expect(after).toMatchObject({
      guildId: NEW_GUILD,
      logChannelId: null,
      panelChannelId: null,
      defaultRecruitChannelId: null,
      defaultVoiceCategoryId: null,
      // Settings that are not Discord ids are the owner's and survive.
      recruitTimeoutHours: 6,
      dailyBonusAmount: 40,
    });

    expect(await configOf(seeded.channelGood)).toEqual({ permissions: ['AttachFiles'], channelIds: [], roleId: null });
    expect(await configOf(seeded.clanGood)).toEqual({ maxMembers: 10, anchorRoleId: null });
    expect(await configOf(seeded.roomGood)).toEqual({ categoryId: null });

    // Prices, names and the on/off switch are the owner's decisions, not Discord ids.
    const good = await db().shopGood.findUniqueOrThrow({ where: { id: seeded.channelGood } });
    expect({ price: good.price, name: good.name, enabled: good.enabled }).toEqual({ price: 5000, name: 'Доступ к картинкам', enabled: true });

    // Money, rights and matches are never touched by a guild change.
    expect((await db().user.findUniqueOrThrow({ where: { id: PLAYER } })).balance).toBe(120);
    expect(await db().kpTransaction.count()).toBe(1);
    expect(await db().roleCapability.count()).toBe(1);
    const match = await db().match.findUniqueOrThrow({ where: { id: seeded.matchId } });
    expect({ channel: match.recruitChannelId, message: match.recruitMessageId, voiceA: match.voiceChannelAId, status: match.status }).toEqual({
      channel: RECRUIT,
      message: '700000000000000001',
      voiceA: '700000000000000002',
      status: 'RECRUITING',
    });
  });

  it('the start after a change is a plain no-op: nothing is dropped twice', async () => {
    const seeded = await seedOldGuild();
    await bindGuildSettings(deps(), NEW_GUILD);
    const stamp = (await db().shopGood.findUniqueOrThrow({ where: { id: seeded.channelGood } })).updatedAt;

    expect(await bindGuildSettings(deps(), NEW_GUILD)).toEqual({ kind: 'same' });

    const again = await db().shopGood.findUniqueOrThrow({ where: { id: seeded.channelGood } });
    expect(again.updatedAt).toEqual(stamp);
    expect((await deps().settings.get()).guildId).toBe(NEW_GUILD);
  });

  it('counts only the goods that held an id, and leaves a good of an unknown kind alone', async () => {
    const { settings } = deps();
    await settings.update({ guildId: OLD_GUILD });
    const clean = await db().shopGood.create({
      data: { slug: 'room', name: 'Комната', description: '', price: 7000, kind: 'personal_room', config: { categoryId: null } },
    });
    const foreign = await db().shopGood.create({
      data: { slug: 'mystery', name: 'Что-то', description: '', price: 1, kind: 'not_a_kind', config: { categoryId: CATEGORY } },
    });

    expect(await bindGuildSettings(deps(), NEW_GUILD)).toMatchObject({ kind: 'changed', goodsCleared: 0 });
    expect(await configOf(clean.id)).toEqual({ categoryId: null });
    expect(await configOf(foreign.id)).toEqual({ categoryId: CATEGORY }); // nothing here knows what that is
  });
});
