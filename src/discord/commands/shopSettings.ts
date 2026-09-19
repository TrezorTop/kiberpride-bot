// /настройки-магазина — the shop's own settings screen (decision 016): the media channels, the room
// category, the clan anchor role, switching goods on and off. Shown in the command list only to
// members with Manage Server; the right that counts is SETTINGS_MANAGE, checked here and again in
// the shop service on every change.
import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { Capability } from '../../modules/permissions/service.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { showShopSettings } from '../shopScreens.js';

export const shopSettingsCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('настройки-магазина')
    .setDescription('Настройки магазина: каналы, категория комнат, роль для кланов, товары')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),

  async run(interaction, ctx) {
    const actor = await actorOf(interaction);
    if (!(await ctx.permissions.can(actor, Capability.SETTINGS_MANAGE))) throw new DomainError('NOT_ALLOWED', '/настройки-магазина');
    await showShopSettings(interaction, ctx, actor);
  },
};
