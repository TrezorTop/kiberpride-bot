// One visual style for every embed (spec §8).
import { EmbedBuilder } from 'discord.js';

export const BRAND_COLOR = 0x8b5cf6;
export const FOOTER = 'KiberPride';

export function brandEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND_COLOR).setFooter({ text: FOOTER });
}
