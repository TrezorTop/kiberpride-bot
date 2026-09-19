// /профиль — balance, the last operations (Q4: five lines plus «Вся история»), purchases with
// their end dates, the daily bonus, the clan and room buttons (decision 014 §10).
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { CommandRoute } from '../router.js';
import { showProfile } from '../shopScreens.js';

export const profileCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('профиль')
    .setDescription('Твой профиль: баланс, операции, покупки и ежедневный бонус')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),

  run: (interaction, ctx) => showProfile(interaction, ctx),
};
