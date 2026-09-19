import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './index.js';
import { shopSettingsView } from '../views/shop.js';

describe('/настройки-магазина (decision 016)', () => {
  it('is its own command, listed only for members who can manage the server', () => {
    const def = commandDefinitions.find((d) => d.name === 'настройки-магазина');
    expect(def).toBeDefined();
    expect(def?.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
  });

  it('the shop settings screen no longer leads back to the games settings', () => {
    const json = JSON.stringify(shopSettingsView([], null).components.map((c) => c.toJSON()));
    expect(json).not.toContain('ssback');
  });
});
