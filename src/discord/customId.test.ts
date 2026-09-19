import { describe, expect, it } from 'vitest';
import { decodeCustomId, encodeCustomId, intArg, MAX_CUSTOM_ID_LENGTH, snowflakeArg, versionArg } from './customId.js';

describe('customId codec', () => {
  it('round-trips an action with id arguments', () => {
    const id = encodeCustomId('mcfm', 42, 3, 'A', '123456789012345678');
    expect(id).toBe('kp1:mcfm:42:3:A:123456789012345678');
    expect(decodeCustomId(id)).toEqual({ action: 'mcfm', args: ['42', '3', 'A', '123456789012345678'] });
  });

  it('accepts an action without arguments', () => {
    expect(decodeCustomId(encodeCustomId('panel'))).toEqual({ action: 'panel', args: [] });
  });

  it('rejects ids of another scheme or shape', () => {
    expect(decodeCustomId('kp0:hist:1')).toBeNull();
    expect(decodeCustomId('hist:1')).toBeNull();
    expect(decodeCustomId('kp1')).toBeNull();
    expect(decodeCustomId('kp1:HIST:1')).toBeNull();
    expect(decodeCustomId('kp1:hist:1::2')).toBeNull();
    expect(decodeCustomId('kp1:hist:пробел')).toBeNull();
    expect(decodeCustomId('')).toBeNull();
  });

  it('rejects anything longer than Discord allows', () => {
    expect(decodeCustomId(`kp1:hist:${'1'.repeat(MAX_CUSTOM_ID_LENGTH)}`)).toBeNull();
    expect(() => encodeCustomId('hist', ...Array.from({ length: 8 }, () => '9'.repeat(20)))).toThrow(/longer than 100/);
  });

  it('refuses to encode names or amounts with separators', () => {
    expect(() => encodeCustomId('hist', 'a:b')).toThrow();
    expect(() => encodeCustomId('hist', 'Команда A')).toThrow();
    expect(() => encodeCustomId('x', 1)).toThrow();
  });

  it('fits every matches action at its longest arguments (decision 008)', () => {
    const id = 2_147_483_647;
    const v = 2_147_483_647;
    const snowflake = '12345678901234567890';
    const longest = [
      encodeCustomId('mcfm', id, v, 'D', snowflake),
      encodeCustomId('mmvp', id, v, 'D'),
      encodeCustomId('mwin', id, v, 'A'),
      encodeCustomId('mccf', id, v),
      encodeCustomId('mcan', id, v),
      encodeCustomId('mtok', id, v),
      encodeCustomId('mspc', id, 1),
      encodeCustomId('mteam', id),
      encodeCustomId('mtest', id),
      encodeCustomId('mleave', id),
      encodeCustomId('mnewf'),
      encodeCustomId('svc', 'n'),
      encodeCustomId('smove'),
      encodeCustomId('stmo'),
    ];
    for (const raw of longest) expect(decodeCustomId(raw)).not.toBeNull();
    expect(decodeCustomId(encodeCustomId('mcfm', 7, 0, 'B', '0'))).toEqual({ action: 'mcfm', args: ['7', '0', 'B', '0'] });
  });

  it('round-trips every shop and earnings action at its longest arguments (decision 014 §10)', () => {
    const id = 2_147_483_647;
    const snowflake = '12345678901234567890';
    const cases: [string, (string | number)[]][] = [
      ['shsel', []],
      ['shbuy', [id, id]],
      ['shbuy', [7, 0]],
      ['shcnew', [id]],
      ['shclan', [id]],
      ['clan', []],
      ['cladd', []],
      ['clrm', []],
      ['clren', []],
      ['clrenf', []],
      ['clleave', []],
      ['room', []],
      ['rmname', []],
      ['rmnamef', []],
      ['rmlim', []],
      ['rmlock', [1]],
      ['rmadd', []],
      ['rmrm', []],
      ['hist', [snowflake]],
      ['hpg', [snowflake, id]],
      ['mybuy', []],
      ['dexp', [id]],
      ['dtop', ['AbC-_12345678xyz']],
      ['daily', []],
      ['sshop', []],
      ['ssback', []],
      ['shch', [id]],
      ['shcat', [id]],
      ['shanc', [id]],
      ['shgs', []],
      ['shen', [id, 1]],
    ];
    for (const [action, args] of cases) {
      expect(decodeCustomId(encodeCustomId(action, ...args))).toEqual({ action, args: args.map(String) });
    }
    // The profile button posted before this step still opens page 1 of the history.
    expect(decodeCustomId('kp1:hist:123456789012345678')).toEqual({ action: 'hist', args: ['123456789012345678'] });
  });

  it('reads a version of 0 (a fresh match) but not a negative or padded one', () => {
    expect(versionArg('0')).toBe(0);
    expect(versionArg('12')).toBe(12);
    expect(versionArg('-1')).toBeNull();
    expect(versionArg('01')).toBeNull();
  });

  it('parses typed arguments strictly', () => {
    expect(intArg('17')).toBe(17);
    expect(intArg('0')).toBeNull();
    expect(intArg('017')).toBeNull();
    expect(intArg('99999999999')).toBeNull();
    expect(intArg(undefined)).toBeNull();
    expect(snowflakeArg('123456789012345678')).toBe('123456789012345678');
    expect(snowflakeArg('12345')).toBeNull();
  });
});
