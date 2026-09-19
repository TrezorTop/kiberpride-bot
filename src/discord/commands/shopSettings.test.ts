import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './index.js';
import { shopSettingsView } from '../views/shop.js';

describe('/настройки-магазина (decision 016)', () => {
  // 016 §2 asked for Manage Server; the owner tightened it to administrators only (2026-09-20),
  // together with /игры and /права. Who sees what is asserted in commands/rights.test.ts.
  it('is its own command, hidden from everyone but administrators', () => {
    const def = commandDefinitions.find((d) => d.name === 'настройки-магазина');
    expect(def).toBeDefined();
    expect(def?.default_member_permissions).toBe('0');
  });

  it('the shop settings screen no longer leads back to the games settings', () => {
    const json = JSON.stringify(shopSettingsView([], null).components.map((c) => c.toJSON()));
    expect(json).not.toContain('ssback');
  });
});
