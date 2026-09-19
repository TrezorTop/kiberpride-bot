// /магазин — the goods, the player's balance and grants, the clan and room buttons (014 §10).
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import type { CommandRoute } from '../router.js';
import { showShop } from '../shopScreens.js';

export const shopCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('магазин')
    .setDescription('Магазин KiberPride: доступ к картинкам и GIF, клан, личная комната')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),

  run: (interaction, ctx) => showShop(interaction, ctx),
};
