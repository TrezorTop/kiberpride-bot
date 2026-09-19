import { describe, expect, it } from 'vitest';
import { formatKp, formatLedgerLine, formatSignedKp, groupDigits } from './format.js';

describe('KP formatting', () => {
  it('shows a balance the way the spec does', () => {
    expect(formatKp(1250)).toBe('💰 1 250 KP');
    expect(formatKp(0)).toBe('💰 0 KP');
    expect(formatKp(999)).toBe('💰 999 KP');
    expect(formatKp(1_000_000)).toBe('💰 1 000 000 KP');
  });

  it('groups digits of negative numbers too', () => {
    expect(groupDigits(-12500)).toBe('-12 500');
  });

  it('signs movements', () => {
    expect(formatSignedKp(100)).toBe('+100 KP');
    expect(formatSignedKp(-500)).toBe('-500 KP');
    expect(formatSignedKp(2500)).toBe('+2 500 KP');
  });

  it('renders a ledger line like the spec examples', () => {
    expect(formatLedgerLine({ amount: 100, description: 'победа в CS2' })).toBe('+100 KP — победа в CS2');
    expect(formatLedgerLine({ amount: -500, description: 'доступ к GIF' })).toBe('-500 KP — доступ к GIF');
  });
});
