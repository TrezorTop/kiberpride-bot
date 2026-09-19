// /начислить (decision 021): hidden from non-administrators, and the amount the owner can type
// is bounded by the command itself, so a slip of the keyboard never reaches the ledger.
import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { ADMIN_ADJUST_MAX, ADMIN_ADJUST_REASON_MAX } from '../../modules/economy/service.js';
import { GRANT_OPTIONS, grantCommand } from './grant.js';
import { commandDefinitions } from './index.js';

const def = grantCommand.definition;
const option = (name: string) => def.options?.find((o) => o.name === name);

describe('/начислить', () => {
  it('is registered and hidden from everyone but administrators (decision 020 §2)', () => {
    expect(commandDefinitions.find((d) => d.name === 'начислить')).toBe(def);
    expect(def.default_member_permissions).toBe('0');
  });

  // The old Python bot on the same server owns /выдать (decision 021, «Rejected»).
  it('is not called /выдать', () => {
    expect(commandDefinitions.map((d) => d.name)).not.toContain('выдать');
  });

  it('asks for a player and an amount, and takes the reason as free text', () => {
    expect(option(GRANT_OPTIONS.user)).toMatchObject({ type: ApplicationCommandOptionType.User, required: true });
    expect(option(GRANT_OPTIONS.amount)).toMatchObject({ type: ApplicationCommandOptionType.Integer, required: true });
    expect(option(GRANT_OPTIONS.reason)).toMatchObject({ type: ApplicationCommandOptionType.String, max_length: ADMIN_ADJUST_REASON_MAX });
    expect(option(GRANT_OPTIONS.reason)?.required ?? false).toBe(false);
  });

  it('bounds the amount both ways, so a negative one takes KP back (decision 021 §1)', () => {
    expect(option(GRANT_OPTIONS.amount)).toMatchObject({ min_value: -ADMIN_ADJUST_MAX, max_value: ADMIN_ADJUST_MAX });
  });
});
