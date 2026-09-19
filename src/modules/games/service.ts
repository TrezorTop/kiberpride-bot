// Game catalogue. Games are rows (decision 003 §7), so a new game or format is data, not code.
// Seeded by prisma/seed.ts.
import type { Db } from '../../db/client.js';

export interface GameView {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  defaultTeamSize: number;
  enabled: boolean;
}

/** A Discord string select holds at most 25 options (decision 008 §3). */
export const MAX_LISTED_GAMES = 25;

export interface GamesService {
  /** Enabled games, the first 25 by id. */
  listEnabled(): Promise<GameView[]>;
  /** Any game, enabled or not; null when there is no such id. */
  get(id: number): Promise<GameView | null>;
}

const select = { id: true, slug: true, name: true, emoji: true, defaultTeamSize: true, enabled: true } as const;

export function createGamesService(db: Db): GamesService {
  return {
    listEnabled: () => db.game.findMany({ where: { enabled: true }, orderBy: { id: 'asc' }, take: MAX_LISTED_GAMES, select }),
    get: (id) => db.game.findUnique({ where: { id }, select }),
  };
}
