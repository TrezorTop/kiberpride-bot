// Rewards — NOT implemented in this step. Amounts come from RewardRule rows (a game's own rule
// overrides the default) and are snapshotted into Match.rewards at creation (decision 003 §8).

export interface RewardAmounts {
  participation: number;
  win: number;
  mvp: number;
  draw: number;
}

export interface RewardsService {
  /** Resolves the amounts for a game at the moment a match is created. */
  resolveFor(gameId: number): Promise<RewardAmounts>;
}
