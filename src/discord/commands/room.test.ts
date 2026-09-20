// /комната (decision 024 §4): every player sees it, and the player option is the administrator's
// way into someone else's room — optional, so the plain command stays «моя комната».
import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './index.js';
import { ROOM_OPTIONS, roomCommand } from './room.js';

const def = roomCommand.definition;

describe('/комната', () => {
  it('is registered and visible to everyone (decision 024 §4)', () => {
    expect(commandDefinitions.find((d) => d.name === 'комната')).toBe(def);
    expect(def.default_member_permissions ?? null).toBeNull();
  });

  // The owner freed the name in their other bot; «/моя-комната» was the earlier proposal (024).
  it('is not called /моя-комната', () => {
    expect(commandDefinitions.map((d) => d.name)).not.toContain('моя-комната');
  });

  it('takes one optional player and nothing else', () => {
    expect(def.options).toHaveLength(1);
    expect(def.options?.[0]).toMatchObject({ name: ROOM_OPTIONS.user, type: ApplicationCommandOptionType.User });
    expect(def.options?.[0]?.required ?? false).toBe(false);
  });
});
