import { describe, expect, it, vi } from 'vitest';
import type { ParticipantSnapshot } from '../../core/match.js';
import { payoutPlan, type PayoutInput } from './payout.js';
import { shuffle } from './shuffle.js';
import { createSyncQueue } from './syncQueue.js';
import { mayAddTestPlayers } from './testPlayers.js';

const p = (userId: string, team: 'A' | 'B' | null, left = false): ParticipantSnapshot => ({
  userId,
  team,
  joinedAt: new Date(0),
  leftServerAt: left ? new Date(1) : null,
});

const base: PayoutInput = {
  id: 9,
  game: { id: 1, name: 'CS2', emoji: '🔫' },
  rewards: { participation: 25, win: 100, mvp: 50, draw: 0 },
  winner: 'A',
  mvpUserId: null,
  participants: [p('300000000000000003', 'B'), p('300000000000000001', 'A'), p('300000000000000002', 'A'), p('300000000000000004', 'B')],
};

describe('payoutPlan', () => {
  it('pays participation to all, the win to the winners, MVP to the MVP — in ascending userId order', () => {
    const plan = payoutPlan({ ...base, mvpUserId: '300000000000000003' });
    expect(plan.map((l) => `${l.userId.slice(-1)}:${l.event}:${l.amount}`)).toEqual([
      '1:participation:25',
      '1:win:100',
      '2:participation:25',
      '2:win:100',
      '3:participation:25',
      '3:mvp:50',
      '4:participation:25',
    ]);
    expect(plan[1]).toMatchObject({ reference: 'match:9:win:300000000000000001', kind: 'MATCH_WIN', description: 'победа в CS2 · матч #9' });
  });

  it('pays no MVP line without an MVP, and none for a 0 amount', () => {
    expect(payoutPlan(base).some((l) => l.event === 'mvp')).toBe(false);
    expect(payoutPlan({ ...base, winner: 'DRAW' }).every((l) => l.event === 'participation')).toBe(true);
  });

  it('a positive draw goes to both teams as its own fact', () => {
    const draws = payoutPlan({ ...base, winner: 'DRAW', rewards: { ...base.rewards, draw: 40 } }).filter((l) => l.event === 'draw');
    expect(draws).toHaveLength(4);
    expect(draws[0]).toMatchObject({ kind: 'MATCH_BONUS', reference: 'match:9:draw:300000000000000001' });
  });

  it('marks the lines of a player who left as withheld, and skips players without a team', () => {
    const plan = payoutPlan({ ...base, participants: [p('300000000000000001', 'A', true), p('300000000000000002', null)] });
    expect(plan.map((l) => [l.event, l.withheld])).toEqual([
      ['participation', true],
      ['win', true],
    ]);
  });

  it('pays nothing for a match without a winner', () => {
    expect(payoutPlan({ ...base, winner: null })).toEqual([]);
  });
});

describe('shuffle', () => {
  it('is a permutation driven by the injected randomness', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const out = shuffle(items, () => 0);
    expect([...out].sort()).toEqual(items);
    expect(out).not.toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]); // input untouched
  });

  it('with the default crypto source keeps every element', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect([...shuffle(items)].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('sync queue (008 §5)', () => {
  it('runs at most one sync per match at a time and coalesces waiting requests into one', async () => {
    let release!: () => void;
    const runs: number[] = [];
    const run = vi.fn((id: number) => {
      runs.push(id);
      return runs.length === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    });
    const queue = createSyncQueue(run, () => {});

    const first = queue.enqueue(1);
    const waiting = [queue.enqueue(1), queue.enqueue(1), queue.enqueue(1)];
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, ...waiting]);
    expect(run).toHaveBeenCalledTimes(2); // the running one plus exactly one rerun
    await queue.idle();
  });

  it('keeps different matches independent and reports failures without rejecting', async () => {
    const errors: number[] = [];
    const queue = createSyncQueue(
      (id) => (id === 2 ? Promise.reject(new Error('discord down')) : Promise.resolve()),
      (id) => errors.push(id),
    );
    await Promise.all([queue.enqueue(1), queue.enqueue(2)]);
    expect(errors).toEqual([2]);
  });
});

describe('test players guard (008 §10)', () => {
  it('only the guild owner, only outside production', () => {
    expect(mayAddTestPlayers({ isGuildOwner: true }, 'development')).toBe(true);
    expect(mayAddTestPlayers({ isGuildOwner: true }, 'test')).toBe(true);
    expect(mayAddTestPlayers({ isGuildOwner: true }, 'production')).toBe(false);
    expect(mayAddTestPlayers({ isGuildOwner: false }, 'development')).toBe(false);
  });
});
