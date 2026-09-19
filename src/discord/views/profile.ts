// /баланс and /профиль screens (decision 014 §10: purchases, the daily bonus, clan and room).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from 'discord.js';
import type { GrantView } from '../../modules/shop/service.js';
import { encodeCustomId } from '../customId.js';
import { formatKp, formatLedgerLine } from './format.js';
import { grantStateText } from './shop.js';
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
  /** ACTIVE purchases; «⏳ заканчивается …» shows here too (decision 015 §1). */
  grants?: readonly GrantView[];
  /** A line about the daily bonus; empty when it is off. */
  dailyLine?: string;
  clan?: 'owner' | 'member' | null;
  hasRoom?: boolean;
  /** Minted per render for «🧪 +10 000 KP Coin»; null = not the owner on the test server. */
  devNonce?: string | null;
  now?: Date;
}

export function profileView(data: ProfileData): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const now = data.now ?? new Date();
  const lines = data.recent.map((e) => `${formatLedgerLine(e)} · <t:${Math.floor(e.createdAt.getTime() / 1000)}:d>`);
  const embed = brandEmbed()
    .setTitle(`Профиль · ${data.displayName}`)
    .addFields(
      { name: 'Баланс', value: formatKp(data.balance) },
      {
        name: 'Последние операции',
        value: lines.length > 0 ? lines.join('\n') : 'Пока пусто — сыграй матч, чтобы заработать первые KP Coin 🎮',
      },
    );
  const grants = data.grants ?? [];
  if (grants.length > 0) embed.addFields({ name: 'Покупки', value: grants.map((g) => `${g.goodName} — ${grantStateText(g, now)}`).join('\n') });
  if (data.dailyLine) embed.setDescription(data.dailyLine);
  if (data.avatarUrl) embed.setThumbnail(data.avatarUrl);

  const button = (id: string, label: string, emoji: string) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(encodeCustomId('hist', data.userId), 'Вся история', '📜'),
    button(encodeCustomId('mybuy'), 'Мои покупки', '🛍️'),
    button(encodeCustomId('daily'), 'Ежедневный бонус', '🎁'),
  );
  const rows = [first];
  const second: ButtonBuilder[] = [];
  if (data.clan) second.push(button(encodeCustomId('clan'), 'Мой клан', '🛡️'));
  if (data.hasRoom) second.push(button(encodeCustomId('room'), 'Моя комната', '🏠'));
  if (data.devNonce) second.push(button(encodeCustomId('dtop', data.devNonce), '+10 000 KP Coin', '🧪'));
  if (second.length > 0) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...second));
  return { embeds: [embed], components: rows };
}
