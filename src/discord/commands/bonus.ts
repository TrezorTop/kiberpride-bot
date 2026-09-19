// /бонус — the daily bonus, once per Moscow day (decisions 013 §3, 014 §5).
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { CommandRoute } from '../router.js';
import { dailyClaimedEmbed } from '../views/shop.js';

export const bonusCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('бонус')
    .setDescription('Забрать ежедневный бонус KP Coin')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),

  async run(interaction, ctx) {
    const r = await ctx.earnings.claimDaily(interaction.user.id);
    await interaction.editReply({ embeds: [dailyClaimedEmbed(r.amount, r.balanceAfter, r.nextAt)] });
  },
};
