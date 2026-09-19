import { describe, expect, it, vi } from 'vitest';
import { encodeCustomId } from './customId.js';
import { deferFor, resolveComponent, type ComponentRoute } from './router.js';

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

describe('deferFor (decisions 007 §1, 008 §3)', () => {
  const fake = () => ({ deferReply: vi.fn(() => Promise.resolve()), deferUpdate: vi.fn(() => Promise.resolve()) });

  it('never defers a modal route — the modal must be the first response', async () => {
    const i = fake();
    await deferFor(i, 'modal');
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.deferUpdate).not.toHaveBeenCalled();
  });

  it('defers an update route as an update and an ephemeral route as a private reply', async () => {
    const u = fake();
    await deferFor(u, 'update');
    expect(u.deferUpdate).toHaveBeenCalledOnce();
    expect(u.deferReply).not.toHaveBeenCalled();

    const e = fake();
    await deferFor(e, 'ephemeral');
    expect(e.deferReply).toHaveBeenCalledOnce();
    expect(e.deferUpdate).not.toHaveBeenCalled();
  });

  it('defers a slash command (no deferUpdate) as a private reply', async () => {
    const command = { deferReply: vi.fn(() => Promise.resolve()) };
    await deferFor(command, 'update');
    expect(command.deferReply).toHaveBeenCalledOnce();
  });

  it('only the creation button is a modal route', async () => {
    const { buttons } = await import('./buttons/index.js');
    const { selects } = await import('./selects/index.js');
    const { modals } = await import('./modals/index.js');
    const modalRoutes = [...buttons, ...selects, ...modals].filter(([, r]) => r.defer === 'modal').map(([a]) => a);
    expect(modalRoutes).toEqual(['mnew']);
  });
});
