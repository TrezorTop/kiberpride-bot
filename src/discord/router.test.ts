import { describe, expect, it } from 'vitest';
import { encodeCustomId } from './customId.js';
import { resolveComponent, type ComponentRoute } from './router.js';

const hist: ComponentRoute<unknown> = { defer: 'ephemeral', run: async () => {} };
const routes = new Map([['hist', hist]]);

describe('router', () => {
  it('routes a known action with its arguments', () => {
    expect(resolveComponent(routes, encodeCustomId('hist', '123456789012345678'))).toEqual({
      route: hist,
      args: ['123456789012345678'],
    });
  });

  it('treats an unknown action as stale', () => {
    expect(resolveComponent(routes, encodeCustomId('mfin', 1))).toBeNull();
  });

  it('treats a malformed or foreign custom_id as stale', () => {
    expect(resolveComponent(routes, 'hist:1')).toBeNull();
    expect(resolveComponent(routes, 'some-other-bot-button')).toBeNull();
  });
});
