// The pure part of `/начислить`: what the player will read in their history (decision 021 §1).
import { describe, expect, it } from 'vitest';
import { ADMIN_ADJUST_DEFAULT_REASON, ADMIN_ADJUST_REASON_MAX, adminAdjustDescription } from './service.js';

describe('adminAdjustDescription (decision 021 §1)', () => {
  it('shows what the administrator typed', () => {
    expect(adminAdjustDescription('приз за турнир')).toBe('приз за турнир');
  });

  it('falls back to «начислено администратором» when there is no reason', () => {
    for (const empty of [undefined, null, '', '   ', '\n\t']) expect(adminAdjustDescription(empty)).toBe(ADMIN_ADJUST_DEFAULT_REASON);
  });

  it('collapses a reason to one line: a ledger line is rendered inline', () => {
    expect(adminAdjustDescription('  приз\nза   турнир  ')).toBe('приз за турнир');
  });

  it('never grows past the length Discord accepts', () => {
    expect(adminAdjustDescription('я'.repeat(200))).toHaveLength(ADMIN_ADJUST_REASON_MAX);
  });
});
