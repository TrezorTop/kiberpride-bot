// /профиль — balance and the last operations (Q4 meanwhile: five lines plus «Вся история»).
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { CommandRoute } from '../router.js';
import { PROFILE_HISTORY_LIMIT, profileView } from '../views/profile.js';

export const profileCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('профиль')
    .setDescription('Твой профиль: баланс и последние операции')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),

  async run(interaction, ctx) {
    const userId = interaction.user.id;
    const { balance } = await ctx.economy.ensureUser(userId);
    const recent = await ctx.economy.history(userId, PROFILE_HISTORY_LIMIT);
    const member = interaction.inCachedGuild() ? interaction.member : null;
    await interaction.editReply(
      profileView({
        userId,
        displayName: member?.displayName ?? interaction.user.displayName,
        avatarUrl: (member ?? interaction.user).displayAvatarURL(),
        balance,
        recent,
      }),
    );
  },
};
