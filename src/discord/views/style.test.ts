import { describe, expect, it } from 'vitest';
import { BRAND_COLOR, brandEmbed, noticeEmbed } from './style.js';

describe('brand style (decision 012)', () => {
  it('uses #226de6', () => {
    expect(BRAND_COLOR).toBe(0x226de6);
    expect(brandEmbed().toJSON().color).toBe(0x226de6);
  });

  it('turns a short notice into a brand embed', () => {
    const json = noticeEmbed('Ты в игре!', '🎮').toJSON();
    expect(json.color).toBe(0x226de6);
    expect(json.description).toBe('Ты в игре!');
    expect(json.title).toBe('🎮');
  });
});
