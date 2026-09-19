// How much a match pays. Amounts come from RewardRule rows (a game's own rule overrides the
// default one, a missing rule is 0) and are snapshotted into Match.rewards at creation
// (decision 003 §8), so changing a rule never changes what an open match promised.
import type { RewardAmounts } from '../../core/match.js';
import type { Db } from '../../db/client.js';

export type { RewardAmounts };

export interface RewardsService {
  /** Resolves the amounts for a game now (decision 008 §12). */
  resolveFor(gameId: number): Promise<RewardAmounts>;
}

const EVENT_KEYS = { PARTICIPATION: 'participation', WIN: 'win', MVP: 'mvp', DRAW: 'draw' } as const;

export function createRewardsService(db: Db): RewardsService {
  return {
    async resolveFor(gameId) {
      const rules = await db.rewardRule.findMany({
        where: { OR: [{ gameId: null }, { gameId }] },
        select: { event: true, gameId: true, amount: true },
      });
      const amounts: RewardAmounts = { participation: 0, win: 0, mvp: 0, draw: 0 };
      // Defaults first, then the game's own rules on top.
      for (const rule of [...rules].sort((a, b) => (a.gameId === null ? 0 : 1) - (b.gameId === null ? 0 : 1))) {
        amounts[EVENT_KEYS[rule.event]] = rule.amount;
      }
      return amounts;
    },
  };
}

/** ⭐ special match: every amount times the factor (decision 009 §1). */
export function scaleRewards(amounts: RewardAmounts, factor: 1 | 2): RewardAmounts {
  return {
    participation: amounts.participation * factor,
    win: amounts.win * factor,
    mvp: amounts.mvp * factor,
    draw: amounts.draw * factor,
  };
}
