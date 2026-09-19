// /игры — the organisers' entry point (decision 008 §1): create a game, open an open match's
// panel, settings. `default_member_permissions = 0` keeps it out of everyone's command list: on a
// real server with real players a command that only refuses them is noise. The owner shows it to
// the organisers in Server Settings → Integrations; the right that counts is still the capability
// checked below, so making it visible to a role grants nothing by itself.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { Capability } from '../../modules/permissions/service.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { gamesPanelView } from '../views/matches.js';

const OPEN_MATCHES_LISTED = 25;

export const gamesCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('игры')
    .setDescription('Управление игровыми активностями: создать игру, открытые матчи, настройки')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(0n)
    .toJSON(),

  async run(interaction, ctx) {
    const actor = await actorOf(interaction);
    const [canCreate, canManageAny, canSettings] = await Promise.all([
      ctx.permissions.can(actor, Capability.ACTIVITY_CREATE),
      ctx.permissions.can(actor, Capability.MATCH_MANAGE_ANY),
      ctx.permissions.can(actor, Capability.SETTINGS_MANAGE),
    ]);
    if (!canCreate && !canManageAny && !canSettings) throw new DomainError('NOT_ALLOWED', '/игры');
    const open = await ctx.matches.listOpen(OPEN_MATCHES_LISTED);
    await interaction.editReply(gamesPanelView(open, { canCreate, canSettings }));
  },
};
