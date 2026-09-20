// /отозвать (decision 023): hidden from non-administrators, and it asks for exactly one thing —
// the player. What may actually be taken back is decided by the screen it opens, never typed.
import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './index.js';
import { REVOKE_OPTIONS, revokeCommand } from './revoke.js';

const def = revokeCommand.definition;

describe('/отозвать', () => {
  it('is registered and hidden from everyone but administrators (decision 020 §2)', () => {
    expect(commandDefinitions.find((d) => d.name === 'отозвать')).toBe(def);
    expect(def.default_member_permissions).toBe('0');
  });

  it('asks for the player and nothing else', () => {
    expect(def.options).toHaveLength(1);
    expect(def.options?.[0]).toMatchObject({ name: REVOKE_OPTIONS.user, type: ApplicationCommandOptionType.User, required: true });
  });
});
