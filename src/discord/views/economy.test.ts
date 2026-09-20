// What the administrator reads after `/начислить`, in both directions (decision 021 §3), and
// the brand colour every message carries (decision 012).
import { describe, expect, it } from 'vitest';
import { domainErrorText } from './messages.js';
import { adminAdjustEmbed, adminAdjustLogLine, type AdminAdjustOutcome } from './economy.js';
import { BRAND_COLOR } from './style.js';

const U = '300000000000000001';
const ACTOR = '100000000000000009';
const outcome = (over: Partial<AdminAdjustOutcome> = {}): AdminAdjustOutcome => ({
  userId: U,
  amount: 500,
  balanceAfter: 1250,
  description: 'приз за турнир',
  applied: true,
  ...over,
});

describe('adminAdjustEmbed', () => {
  it.each([outcome(), outcome({ amount: -500, balanceAfter: 250 }), outcome({ applied: false })])('is a brand embed', (o) => {
    expect(adminAdjustEmbed(o).toJSON().color).toBe(BRAND_COLOR);
  });

  it('says «Начислил» and names the player, the amount and the balance', () => {
    const json = adminAdjustEmbed(outcome()).toJSON();
    expect(json.title).toBe('💰 Начисление');
    expect(json.description).toContain(`✅ Начислил <@${U}> 💰 500 KP Coin`);
    expect(json.description).toContain('За что: приз за турнир');
    expect(json.description).toContain('Баланс игрока: 💰 1 250 KP Coin');
  });

  it('says «Снял» for a negative amount, and never shows a minus twice', () => {
    const json = adminAdjustEmbed(outcome({ amount: -500, balanceAfter: 250, description: 'ошибка в начислении' })).toJSON();
    expect(json.title).toBe('💰 Списание');
    expect(json.description).toContain(`✅ Снял с <@${U}> 💰 500 KP Coin`);
    expect(json.description).not.toContain('-500');
  });

  it('says plainly when the same invocation arrived twice and nothing moved', () => {
    expect(adminAdjustEmbed(outcome({ applied: false })).toJSON().description).toContain('второй раз KP Coin не двигались');
    expect(adminAdjustEmbed(outcome()).toJSON().description).not.toContain('второй раз');
  });
});

describe('adminAdjustLogLine (rule bot-always-on §3)', () => {
  it('names the administrator, the player, the amount and the reason', () => {
    expect(adminAdjustLogLine(ACTOR, outcome())).toBe(`💰 <@${ACTOR}> начислил <@${U}> +500 KP Coin — приз за турнир`);
  });

  it('reads the other way round when KP were taken', () => {
    expect(adminAdjustLogLine(ACTOR, outcome({ amount: -500, description: 'ошибка' }))).toBe(`💰 <@${ACTOR}> снял у <@${U}> -500 KP Coin — ошибка`);
  });

  it('marks a repeat, so the log never looks like two payments', () => {
    expect(adminAdjustLogLine(ACTOR, outcome({ applied: false }))).toContain('(повтор — KP Coin не двигались)');
  });
});

describe('the refusals an administrator can meet', () => {
  it('says how much the player actually has', () => {
    expect(domainErrorText({ code: 'BALANCE_TOO_LOW', params: { balance: 120 } })).toBe('У игрока сейчас 💰 120 KP Coin — снять больше нельзя. Ничего не изменилось.');
  });

  it('still answers when the balance is unknown', () => {
    expect(domainErrorText({ code: 'BALANCE_TOO_LOW' })).toContain('снять больше, чем есть, нельзя');
  });

  it('explains a zero or an out-of-range amount, and a bot target', () => {
    expect(domainErrorText({ code: 'AMOUNT_INVALID' })).toContain('не ноль');
    expect(domainErrorText({ code: 'TARGET_IS_BOT' })).toContain('Ботам');
  });
});
