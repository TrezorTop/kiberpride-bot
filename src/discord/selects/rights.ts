// The two selects of `/права`: pick a right, then pick the roles that hold it. Saving replaces
// the whole set for that right — the roles left out lose it. @everyone and bot roles are refused
// here (the service refuses @everyone again, because select values come from the client).
import type { AnySelectMenuInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { requireSettingsRight } from '../panels.js';
import { capabilityArg, showRights } from '../rightsScreen.js';
import type { ComponentRoute } from '../router.js';
import { rightsLogLine } from '../views/rights.js';

type Route = ComponentRoute<AnySelectMenuInteraction>;

/** `kp1:rcap` — which right the admin is about to hand out. */
export const capabilitySelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    await requireSettingsRight(interaction, ctx);
    await showRights(interaction, ctx, capabilityArg(interaction.values[0]));
  },
};

/** `kp1:rrol:<capability>` — the roles that hold it, as a whole set. */
export const rightRolesSelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const capability = capabilityArg(args[0]);
    if (!interaction.isRoleSelectMenu()) throw new DomainError('STALE_PANEL', 'not a role select');

    const picked = [...interaction.roles.values()];
    for (const role of picked) {
      // @everyone would hand the right to the whole server; a bot's own role cannot be given out.
      if (role.id === ctx.guild.id || role.managed) throw new DomainError('ROLE_NOT_GRANTABLE', role.id);
    }

    const change = await ctx.permissions.setRoles(
      actor,
      capability,
      picked.map((r) => r.id),
    );
    if (change.added.length === 0 && change.removed.length === 0) {
      await showRights(interaction, ctx, capability, 'Ничего не изменилось — эти роли уже были выбраны.');
      return;
    }
    await ctx.logging.event(
      'rights.set',
      { capability, actorId: actor.userId, added: change.added, removed: change.removed },
      rightsLogLine(actor.userId, capability, change),
    );
    await showRights(interaction, ctx, capability, '✅ Сохранил. Ниже видно, у кого теперь какие права.');
  },
};
