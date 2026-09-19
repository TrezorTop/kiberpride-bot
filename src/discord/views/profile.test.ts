import { describe, expect, it } from 'vitest';
import { decodeCustomId } from '../customId.js';
import { balanceEmbed, profileView } from './profile.js';

describe('profile views', () => {
  it('shows a new player’s balance as 💰 0 KP', () => {
    expect(balanceEmbed(0).toJSON().description).toContain('💰 0 KP');
  });

  it('lists the recent operations and links the full history', () => {
    const view = profileView({
      userId: '123456789012345678',
      displayName: 'Игрок',
      avatarUrl: null,
      balance: 1250,
      recent: [{ amount: 100, description: 'победа в CS2', createdAt: new Date('2026-09-19T12:00:00Z') }],
    });
    const fields = view.embeds[0]?.toJSON().fields ?? [];
    expect(fields[0]?.value).toBe('💰 1 250 KP');
    expect(fields[1]?.value).toContain('+100 KP — победа в CS2');
    const button = view.components[0]?.toJSON().components[0] as { custom_id?: string } | undefined;
    expect(decodeCustomId(button?.custom_id ?? '')).toEqual({ action: 'hist', args: ['123456789012345678'] });
  });

  it('says what to do when there is no history yet', () => {
    const view = profileView({ userId: '123456789012345678', displayName: 'Игрок', avatarUrl: null, balance: 0, recent: [] });
    expect(view.embeds[0]?.toJSON().fields?.[1]?.value).toMatch(/сыграй матч/);
  });
});
