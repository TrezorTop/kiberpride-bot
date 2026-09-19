// /баланс — the player's KP, privately.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { CommandRoute } from '../router.js';
import { balanceEmbed } from '../views/profile.js';

export const balanceCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('баланс')
    .setDescription('Сколько у тебя KP Coin')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),

  async run(interaction, ctx) {
    const { balance } = await ctx.economy.ensureUser(interaction.user.id);
    await interaction.editReply({ embeds: [balanceEmbed(balance)] });
  },
};
