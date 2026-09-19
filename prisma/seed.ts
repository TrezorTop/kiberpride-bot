// Default configuration rows (decision 002 §6). CREATE-ONLY: a row that exists is never
// overwritten, so whatever the owner changed from the admin panel survives every re-run.
// Runs at container start after `migrate deploy` (Dockerfile) and locally via `npm run db:seed`.
//
// Shop goods (decisions 013, 014 §7, 015) are seeded DISABLED: each needs the owner's server
// picked first (channels, the room category, the clan anchor role) in /игры → ⚙️ Настройки →
// 🛒 Магазин, and enabling is refused while anything is missing. GuildSettings gets the daily
// bonus 50, voice 10 per hour and cap 60 from the column defaults.
import { config } from 'dotenv';
import { createDb } from '../src/db/client.js';
import { RewardEvent } from '../src/generated/prisma/enums.js';
import type { ChannelPermissionConfig } from '../src/modules/shop/kinds/channelPermission.js';
import { DEFAULT_CLAN_PALETTE, DEFAULT_FORBIDDEN_WORDS, type ClanRoleConfig } from '../src/modules/shop/kinds/clanRole.js';
import type { PersonalRoomConfig } from '../src/modules/shop/kinds/personalRoom.js';

const GAMES = [
  { slug: 'cs2', name: 'CS2', emoji: '🔫', defaultTeamSize: 5 },
  { slug: 'valorant', name: 'Valorant', emoji: '🎯', defaultTeamSize: 5 },
  { slug: 'dota2', name: 'Dota 2', emoji: '🛡️', defaultTeamSize: 5 },
  { slug: 'mafia', name: 'Мафия', emoji: '🕵️', defaultTeamSize: 5 },
];

// PLACEHOLDER amounts from the owner's brief (spec §5 examples); the owner sets real ones in
// the admin panel. DRAW 0 = nothing extra on a draw (decision 004 §4 skips a zero amount).
const DEFAULT_REWARDS: { event: RewardEvent; amount: number }[] = [
  { event: RewardEvent.WIN, amount: 100 },
  { event: RewardEvent.PARTICIPATION, amount: 25 },
  { event: RewardEvent.MVP, amount: 50 },
  { event: RewardEvent.DRAW, amount: 0 },
];

const mediaConfig: ChannelPermissionConfig = { permissions: ['AttachFiles', 'EmbedLinks'], channelIds: [], roleId: null };
const clanConfig: ClanRoleConfig = { maxMembers: 10, forbiddenWords: DEFAULT_FORBIDDEN_WORDS, palette: DEFAULT_CLAN_PALETTE, anchorRoleId: null };
const roomConfig: PersonalRoomConfig = { categoryId: null };

// Prices of decisions 013 §2 and 015 §2; 30 days each; disabled until configured.
const GOODS = [
  {
    slug: 'media_access',
    name: 'Доступ к картинкам и GIF',
    description: 'Картинки, файлы и GIF в выбранных каналах на 30 дней.',
    price: 5000,
    kind: 'channel_permission',
    config: mediaConfig,
    sortOrder: 10,
  },
  {
    slug: 'clan_role',
    name: 'Клановая роль',
    description: 'Своя роль с названием и цветом для тебя и до 10 друзей на 30 дней.',
    price: 15000,
    kind: 'clan_role',
    config: clanConfig,
    sortOrder: 20,
  },
  {
    slug: 'personal_room',
    name: 'Личная комната',
    description: 'Свой голосовой канал: ты решаешь, кто заходит. 30 дней.',
    price: 10000,
    kind: 'personal_room',
    config: roomConfig,
    sortOrder: 30,
  },
];

async function seed(): Promise<void> {
  config({ quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url, { maxConnections: 2 });
  try {
    await db.guildSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

    for (const game of GAMES) {
      await db.game.upsert({ where: { slug: game.slug }, create: game, update: {} });
    }

    // Default rules have gameId = null; a compound unique with a null cannot be upserted by
    // Prisma, so it is find-then-create (the partial unique index stops a racing duplicate).
    for (const rule of DEFAULT_REWARDS) {
      const existing = await db.rewardRule.findFirst({ where: { event: rule.event, gameId: null } });
      if (!existing) await db.rewardRule.create({ data: { event: rule.event, gameId: null, amount: rule.amount } });
    }

    for (const good of GOODS) {
      await db.shopGood.upsert({ where: { slug: good.slug }, create: { ...good, validityDays: 30, enabled: false }, update: {} });
    }

    console.log(
      `seed: settings, ${GAMES.length} games, ${DEFAULT_REWARDS.length} default reward rules, ${GOODS.length} shop goods (disabled) ensured`,
    );
  } finally {
    await db.$disconnect();
  }
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
