import { describe, expect, it } from 'vitest';
import { decodeCustomId, encodeCustomId, intArg, MAX_CUSTOM_ID_LENGTH, snowflakeArg } from './customId.js';

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
