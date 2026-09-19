import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './index.js';

const def = (name: string) => commandDefinitions.find((d) => d.name === name);

describe('who sees which command', () => {
  // Owner, 2026-09-20: the three admin commands are hidden from everyone but members whose role
  // carries Discord's Administrator permission; the owner shows /игры to the organisers in
  // Server Settings → Integrations. The capability check in each command is the real guard.
  it.each(['игры', 'настройки-магазина', 'права'])('/%s is hidden from everyone but administrators', (name) => {
    expect(def(name)).toBeDefined();
    expect(def(name)?.default_member_permissions).toBe('0');
  });

  it.each(['баланс', 'профиль', 'магазин', 'бонус'])('/%s stays open to every player', (name) => {
    expect(def(name)).toBeDefined();
    expect(def(name)?.default_member_permissions ?? null).toBeNull();
  });

  it('every command answers only inside the guild', () => {
    for (const d of commandDefinitions) expect(d.contexts).toEqual([0]);
  });
});
