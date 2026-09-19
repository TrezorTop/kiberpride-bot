// Default configuration rows (decision 002 §6). CREATE-ONLY: a row that exists is never
// overwritten, so whatever the owner changed from the admin panel survives every re-run.
// Runs at container start after `migrate deploy` (Dockerfile) and locally via `npm run db:seed`.
//
// Shop goods are NOT seeded: an image/GIF access good needs a real role and channel id of the
// owner's server, and the shop kinds do not exist yet (decision 002 §5). The shop step adds them.
import { config } from 'dotenv';
import { createDb } from '../src/db/client.js';
import { RewardEvent } from '../src/generated/prisma/enums.js';

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

    console.log(`seed: settings, ${GAMES.length} games, ${DEFAULT_REWARDS.length} default reward rules ensured`);
  } finally {
    await db.$disconnect();
  }
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
