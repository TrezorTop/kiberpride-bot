// /баланс and /профиль screens.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from 'discord.js';
import { encodeCustomId } from '../customId.js';
import { formatKp, formatLedgerLine } from './format.js';
import { brandEmbed } from './style.js';

export const PROFILE_HISTORY_LIMIT = 5;

export function balanceEmbed(balance: number): EmbedBuilder {
  return brandEmbed()
    .setTitle('Твой баланс')
    .setDescription(`## ${formatKp(balance)}`);
}

export interface ProfileData {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  balance: number;
  recent: { amount: number; description: string; createdAt: Date }[];
}

export function profileView(data: ProfileData): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const lines = data.recent.map((e) => `${formatLedgerLine(e)} · <t:${Math.floor(e.createdAt.getTime() / 1000)}:d>`);
  const embed = brandEmbed()
    .setTitle(`Профиль · ${data.displayName}`)
    .addFields(
      { name: 'Баланс', value: formatKp(data.balance) },
      {
        name: 'Последние операции',
        value: lines.length > 0 ? lines.join('\n') : 'Пока пусто — сыграй матч, чтобы заработать первые KP 🎮',
      },
    );
  if (data.avatarUrl) embed.setThumbnail(data.avatarUrl);

  const history = new ButtonBuilder()
    .setCustomId(encodeCustomId('hist', data.userId))
    .setLabel('Вся история')
    .setEmoji('📜')
    .setStyle(ButtonStyle.Secondary);
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(history)] };
}
