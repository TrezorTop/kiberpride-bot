// «Вся история» (decision 014 §10): `kp1:hist:<userId>` opens page 1 — the id format of the
// profiles already posted stays decodable — and `kp1:hpg:<userId>:<page>` pages 10 lines at a
// time. Another player's history needs ECONOMY_ADMIN.
import type { ButtonInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { Capability } from '../../modules/permissions/service.js';
import { intArg, snowflakeArg } from '../customId.js';
import { actorOf } from '../member.js';
import type { AppContext, ComponentRoute } from '../router.js';
import { historyView } from '../views/shop.js';

async function showHistory(interaction: ButtonInteraction, ctx: AppContext, userArg: string | undefined, page: number): Promise<void> {
  const userId = snowflakeArg(userArg);
  if (!userId) throw new DomainError('STALE_PANEL', `bad user ${userArg}`);
  const own = userId === interaction.user.id;
  if (!own && !(await ctx.permissions.can(await actorOf(interaction), Capability.ECONOMY_ADMIN))) {
    throw new DomainError('NOT_ALLOWED', `history of ${userId}`);
  }
  const view = historyView(userId, await ctx.economy.historyPage(userId, page), own);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}

export const historyButton: ComponentRoute<ButtonInteraction> = {
  defer: 'ephemeral',
  run: (interaction, args, ctx) => showHistory(interaction, ctx, args[0], 1),
};

export const historyPageButton: ComponentRoute<ButtonInteraction> = {
  defer: 'update',
  run: (interaction, args, ctx) => showHistory(interaction, ctx, args[0], intArg(args[1]) ?? 1),
};
