// /права — who on the server may do what: the capability table and the two selects that change
// it. `default_member_permissions = 0` keeps it out of every list but an Administrator's (owner,
// 2026-09-20); the right that counts is SETTINGS_MANAGE, checked here and again in the
// permissions service on every save.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { Capability } from '../../modules/permissions/service.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { showRights } from '../rightsScreen.js';

export const rightsCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('права')
    .setDescription('Кто может создавать игры, управлять матчами, магазином и настройками')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(0n)
    .toJSON(),

  async run(interaction, ctx) {
    const actor = await actorOf(interaction);
    if (!(await ctx.permissions.can(actor, Capability.SETTINGS_MANAGE))) throw new DomainError('NOT_ALLOWED', '/права');
    await showRights(interaction, ctx, null);
  },
};
