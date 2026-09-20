// /отозвать — an administrator takes a bought good back, with or without a refund (decision 023).
// `default_member_permissions = 0` keeps it out of every list but an Administrator's (decision
// 020 §2); the right that counts is SHOP_MANAGE, checked in the shop service on every call.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { revokeListView } from '../views/shop.js';

/** Option names, in one place: the handler reads exactly what the definition declares. */
export const REVOKE_OPTIONS = { user: 'игрок' } as const;

export const revokeCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('отозвать')
    .setDescription('Снять с игрока купленное — с возвратом KP Coin или без')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(0n)
    .addUserOption((o) => o.setName(REVOKE_OPTIONS.user).setDescription('У кого').setRequired(true))
    .toJSON(),

  async run(interaction, ctx) {
    const actor = await actorOf(interaction);
    const target = interaction.options.getUser(REVOKE_OPTIONS.user, true);
    const items = await ctx.shop.revokeList(actor, target.id);
    await interaction.editReply(revokeListView(target.id, items));
  },
};
