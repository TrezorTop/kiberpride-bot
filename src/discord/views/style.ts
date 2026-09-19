// One visual style for every embed (spec §8, decision 012): one brand colour, one footer, and
// every message a player sees is an embed — including short notices and errors.
import { EmbedBuilder } from 'discord.js';

export const BRAND_COLOR = 0x226de6;
export const FOOTER = 'KiberPride';

export function brandEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND_COLOR).setFooter({ text: FOOTER });
}

/** A short notice (confirmation, error, log line) as a brand embed. */
export function noticeEmbed(text: string, title?: string): EmbedBuilder {
  const embed = brandEmbed().setDescription(text);
  return title ? embed.setTitle(title) : embed;
}
