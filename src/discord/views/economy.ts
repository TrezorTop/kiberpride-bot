// What an administrator sees after `/начислить`, and the line the log channel keeps (decision
// 021 §3). The player is not notified: the movement shows up in their history, no new pings.
import type { EmbedBuilder } from 'discord.js';
import { formatKp, formatSignedKp } from './format.js';
import { noticeEmbed } from './style.js';

export interface AdminAdjustOutcome {
  /** The player whose balance moved. */
  userId: string;
  /** Signed: positive was given, negative was taken. */
  amount: number;
  balanceAfter: number;
  /** The history line the player will see. */
  description: string;
  /** false = the same invocation reached the bot twice; nothing moved the second time. */
  applied: boolean;
}

/** «✅ Начислил <@…> 💰 500 KP Coin» / «✅ Снял с <@…> 💰 500 KP Coin», privately. */
export function adminAdjustEmbed(o: AdminAdjustOutcome): EmbedBuilder {
  const given = o.amount > 0;
  const head = given ? `✅ Начислил <@${o.userId}> ${formatKp(o.amount)}` : `✅ Снял с <@${o.userId}> ${formatKp(-o.amount)}`;
  const lines = [
    head,
    o.applied ? null : 'ℹ️ Это уже было применено раньше — второй раз KP Coin не двигались.',
    `За что: ${o.description}`,
    `Баланс игрока: ${formatKp(o.balanceAfter)}`,
  ];
  return noticeEmbed(lines.filter(Boolean).join('\n'), given ? '💰 Начисление' : '💰 Списание');
}

/** The audit line: who moved what, to whom and why (rule bot-always-on §3). */
export function adminAdjustLogLine(actorId: string, o: AdminAdjustOutcome): string {
  const verb = o.amount > 0 ? 'начислил' : 'снял у';
  const repeat = o.applied ? '' : ' (повтор — KP Coin не двигались)';
  return `💰 <@${actorId}> ${verb} <@${o.userId}> ${formatSignedKp(o.amount)} — ${o.description}${repeat}`;
}
