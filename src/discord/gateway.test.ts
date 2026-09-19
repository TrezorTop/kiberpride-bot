import { describe, expect, it } from 'vitest';
import { knownRoleIds } from './gateway.js';

describe('team channel roles (review 2026-09-20)', () => {
  it('keeps the roles the guild still has, in order, and names the rest', () => {
    const guild = new Set(['600000000000000001', '600000000000000003']);
    expect(knownRoleIds(['600000000000000001', '600000000000000002', '600000000000000003'], (id) => guild.has(id))).toEqual({
      kept: ['600000000000000001', '600000000000000003'],
      dropped: ['600000000000000002'],
    });
    expect(knownRoleIds([], () => true)).toEqual({ kept: [], dropped: [] });
  });
});
