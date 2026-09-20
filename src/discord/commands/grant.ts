// /начислить — an administrator moves KP Coin by hand, either way (decision 021). The old Python
// bot owns /выдать on the same server, hence the name. `default_member_permissions = 0` keeps it
// out of every list but an Administrator's (decision 020 §2); the right that counts is
// ECONOMY_ADMIN, checked in the economy service on every call.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { ADMIN_ADJUST_MAX, ADMIN_ADJUST_REASON_MAX } from '../../modules/economy/service.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { adminAdjustEmbed, adminAdjustLogLine } from '../views/economy.js';

/** Option names, in one place: the handler reads exactly what the definition declares. */
export const GRANT_OPTIONS = { user: 'игрок', amount: 'сколько', reason: 'за_что' } as const;

export const grantCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('начислить')
    .setDescription('Начислить игроку KP Coin — или снять их, указав сумму со знаком минус')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(0n)
    .addUserOption((o) => o.setName(GRANT_OPTIONS.user).setDescription('Кому').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName(GRANT_OPTIONS.amount)
        .setDescription('Сколько KP Coin: со знаком минус — снять')
        .setRequired(true)
        .setMinValue(-ADMIN_ADJUST_MAX)
        .setMaxValue(ADMIN_ADJUST_MAX),
    )
    .addStringOption((o) => o.setName(GRANT_OPTIONS.reason).setDescription('За что — игрок увидит это в своей истории').setMaxLength(ADMIN_ADJUST_REASON_MAX))
    .toJSON(),

  async run(interaction, ctx) {
    const actor = await actorOf(interaction);
    const target = interaction.options.getUser(GRANT_OPTIONS.user, true);
    const amount = interaction.options.getInteger(GRANT_OPTIONS.amount, true);
    const reason = interaction.options.getString(GRANT_OPTIONS.reason);

    // The interaction's own id is this invocation's name: Discord may deliver one command twice
    // (a gateway resume), and both deliveries then carry the same reference (decision 021 §4).
    const result = await ctx.economy.adminAdjust(actor, { userId: target.id, amount, reason, nonce: interaction.id, targetIsBot: target.bot });
    const outcome = {
      userId: target.id,
      amount: result.entry.amount,
      balanceAfter: result.entry.balanceAfter,
      description: result.entry.description,
      applied: result.applied,
    };

    // Log BEFORE the reply: the money has committed, and a failed `editReply` would otherwise
    // lose the audit line and invite the administrator to pay again (review 2026-09-20).
    await ctx.logging.event(
      'economy.admin_adjust',
      { actorId: actor.userId, userId: target.id, amount: outcome.amount, applied: result.applied, reference: result.entry.reference },
      adminAdjustLogLine(actor.userId, outcome),
    );
    await interaction.editReply({ embeds: [adminAdjustEmbed(outcome)] });
  },
};
