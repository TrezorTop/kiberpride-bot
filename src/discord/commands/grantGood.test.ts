// /выдать-товар (decision 024 §1): hidden from non-administrators, the good is picked from a
// fixed list instead of typed, and the days the owner can type are bounded by the command itself.
import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { GRANT_DAYS_MAX, GRANT_DAYS_MIN } from '../../modules/shop/service.js';
import { GRANT_GOOD_CHOICES, GRANT_GOOD_OPTIONS, grantGoodCommand } from './grantGood.js';
import { commandDefinitions } from './index.js';

const def = grantGoodCommand.definition;
const option = (name: string) => def.options?.find((o) => o.name === name);

describe('/выдать-товар', () => {
  it('is registered and hidden from everyone but administrators (decision 020 §2)', () => {
    expect(commandDefinitions.find((d) => d.name === 'выдать-товар')).toBe(def);
    expect(def.default_member_permissions).toBe('0');
  });

  it('asks for a player and a good, both required; the days are optional', () => {
    expect(option(GRANT_GOOD_OPTIONS.user)).toMatchObject({ type: ApplicationCommandOptionType.User, required: true });
    expect(option(GRANT_GOOD_OPTIONS.good)).toMatchObject({ type: ApplicationCommandOptionType.String, required: true });
    expect(option(GRANT_GOOD_OPTIONS.days)).toMatchObject({ type: ApplicationCommandOptionType.Integer });
    expect(option(GRANT_GOOD_OPTIONS.days)?.required ?? false).toBe(false);
  });

  // The choice carries the slug, which survives a re-seed; a row id would not (024 §1).
  it('offers the three goods of the catalogue by slug, never a typed id', () => {
    const choices = (option(GRANT_GOOD_OPTIONS.good) as { choices?: { value: string }[] }).choices ?? [];
    expect(choices.map((c) => c.value)).toEqual(['media_access', 'clan_role', 'personal_room']);
    expect(choices).toHaveLength(GRANT_GOOD_CHOICES.length);
  });

  it('bounds the days, so a slip of the keyboard never gives a century of access (024 §1)', () => {
    expect(option(GRANT_GOOD_OPTIONS.days)).toMatchObject({ min_value: GRANT_DAYS_MIN, max_value: GRANT_DAYS_MAX });
    expect(GRANT_DAYS_MIN).toBe(1);
    expect(GRANT_DAYS_MAX).toBe(365);
  });
});
