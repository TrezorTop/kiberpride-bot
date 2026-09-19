import { describe, expect, it } from 'vitest';
import { DEFAULT_FORBIDDEN_WORDS } from './kinds/clanRole.js';
import { nameProblem, normalizeName } from './names.js';

const rules = { forbiddenWords: DEFAULT_FORBIDDEN_WORDS, roleNames: ['@everyone', 'Модератор', 'VIP'] };

describe('clan and room names (decision 014 §3.2)', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeName('  Ночные \t  волки \n')).toBe('Ночные волки');
  });

  it('accepts letters, digits, spaces, -_.!? and emoji', () => {
    for (const ok of ['Волки', 'Team 42', 'Лиса-Огонь', 'go_go', 'Ура!', 'Кто?', 'Mr.Clan', '🐺 Стая', '👨‍👩‍👧 Семья', '🇷🇺 Русь', '1️⃣ Первые']) {
      expect({ ok, problem: nameProblem(ok, rules) }).toEqual({ ok, problem: null });
    }
  });

  it('refuses a length outside 2..32 characters', () => {
    expect(nameProblem('A', rules)).toBe('length');
    expect(nameProblem('Б'.repeat(33), rules)).toBe('length');
    expect(nameProblem('Б'.repeat(32), rules)).toBeNull();
  });

  it('refuses @ # : ` and other symbols', () => {
    for (const bad of ['@here', 'клан#1', 'a:b', 'code`', 'a/b', '<@123>', 'клан|x']) expect(nameProblem(bad, rules)).toBe('chars');
  });

  it('refuses links and invites', () => {
    for (const bad of ['discord.gg abc', 'mysite.com', 'www.x', 'клан.рф', 'discord . gg']) expect(nameProblem(bad, rules)).toBe('link');
    expect(nameProblem('Mr.Clan', rules)).toBeNull();
  });

  it('refuses everyone / here, a server role name, and forbidden words — in any case', () => {
    expect(nameProblem('Everyone', rules)).toBe('reserved');
    expect(nameProblem('here', rules)).toBe('reserved');
    expect(nameProblem('vip', rules)).toBe('role_taken');
    expect(nameProblem('МОДЕРАТОР', rules)).toBe('role_taken');
    expect(nameProblem('Супер Админы', rules)).toBe('forbidden');
    expect(nameProblem('KiberPride Team', rules)).toBe('forbidden');
    expect(nameProblem('Staffers', rules)).toBe('forbidden');
  });

  it('a room name needs only the character rules', () => {
    expect(nameProblem('Модератор')).toBeNull();
    expect(nameProblem('#комната')).toBe('chars');
  });
});
