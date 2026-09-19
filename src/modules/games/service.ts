// Game catalogue — NOT implemented in this step. Games are rows (decision 003 §7), so a new
// game or format is data, not code. Seeded by prisma/seed.ts.

export interface GameView {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  defaultTeamSize: number;
}

export interface GamesService {
  listEnabled(): Promise<GameView[]>;
  get(id: number): Promise<GameView | null>;
}
