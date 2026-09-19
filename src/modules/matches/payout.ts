// What a finished match pays, as a pure function of the match (decision 004 §4, 009 §3). The
// finish transaction applies it; the result card renders it; the same references make a replay,
// or a later manual payment of a withheld line, a no-op (003 §3, 004 §5).
import type { MatchSnapshot } from '../../core/match.js';

export type PayoutEvent = 'participation' | 'win' | 'draw' | 'mvp';
export type PayoutKind = 'MATCH_PARTICIPATION' | 'MATCH_WIN' | 'MATCH_BONUS' | 'MATCH_MVP';

export interface PayoutLine {
  userId: string;
  event: PayoutEvent;
  amount: number;
  kind: PayoutKind;
  /** The identity of this economic fact: `match:<id>:<event>:<userId>`. */
  reference: string;
  /** The history line the player reads, e.g. «победа в CS2 · матч #12». */
  description: string;
  /** The player left the server during the match: logged, not paid (Q2 meanwhile). */
  withheld: boolean;
}

export type PayoutInput = Pick<MatchSnapshot, 'id' | 'game' | 'rewards' | 'winner' | 'mvpUserId' | 'participants'>;

// A draw is its own fact (reference `draw`, kind MATCH_BONUS), so profile statistics that count
// MATCH_WIN rows never count a draw as a win.
const KIND: Record<PayoutEvent, PayoutKind> = {
  participation: 'MATCH_PARTICIPATION',
  win: 'MATCH_WIN',
  draw: 'MATCH_BONUS',
  mvp: 'MATCH_MVP',
};
const WORD: Record<PayoutEvent, string> = { participation: 'участие', win: 'победа', draw: 'ничья', mvp: 'MVP' };
const ORDER: Record<PayoutEvent, number> = { participation: 0, win: 1, draw: 1, mvp: 2 };

/**
 * Every reward line of a finished match, ordered by userId ascending (then by event), so two
 * finish transactions paying overlapping players lock User rows in the same order (007).
 * Amounts of 0 produce no line (the ledger refuses a 0 movement).
 */
export function payoutPlan(match: PayoutInput): PayoutLine[] {
  if (!match.winner) return [];
  const lines: PayoutLine[] = [];
  const add = (userId: string, event: PayoutEvent, amount: number, withheld: boolean) => {
    if (amount <= 0) return;
    lines.push({
      userId,
      event,
      amount,
      kind: KIND[event],
      reference: `match:${match.id}:${event}:${userId}`,
      description: `${WORD[event]} в ${match.game.name} · матч #${match.id}`,
      withheld,
    });
  };

  for (const p of match.participants) {
    if (!p.team) continue; // only players who were on a team played
    const withheld = p.leftServerAt !== null;
    add(p.userId, 'participation', match.rewards.participation, withheld);
    if (match.winner === 'DRAW') add(p.userId, 'draw', match.rewards.draw, withheld);
    else if (p.team === match.winner) add(p.userId, 'win', match.rewards.win, withheld);
    if (p.userId === match.mvpUserId) add(p.userId, 'mvp', match.rewards.mvp, withheld);
  }

  return lines.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : ORDER[a.event] - ORDER[b.event]));
}

/** Per-player totals for the result card, paid and withheld apart. */
export function payoutTotals(lines: readonly PayoutLine[]): { paid: Map<string, number>; withheld: Map<string, number> } {
  const paid = new Map<string, number>();
  const withheld = new Map<string, number>();
  for (const line of lines) {
    const into = line.withheld ? withheld : paid;
    into.set(line.userId, (into.get(line.userId) ?? 0) + line.amount);
  }
  return { paid, withheld };
}
