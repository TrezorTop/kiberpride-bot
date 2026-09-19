// The one place the `/права` screen is rendered (command and both selects). The rights are read
// through the permissions service; the handlers re-check SETTINGS_MANAGE before they get here.
import type { AnySelectMenuInteraction, ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { DomainError } from '../core/errors.js';
import { CAPABILITIES, type CapabilityName } from '../modules/permissions/service.js';
import type { AppContext } from './router.js';
import { rightsView } from './views/rights.js';

type Answerable = ChatInputCommandInteraction | ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

/** A capability name out of a custom_id or a select value; anything else is a stale panel. */
export function capabilityArg(value: string | undefined): CapabilityName {
  const found = CAPABILITIES.find((c) => c === value);
  if (!found) throw new DomainError('STALE_PANEL', `capability ${value ?? '-'}`);
  return found;
}

export async function showRights(interaction: Answerable, ctx: AppContext, selected: CapabilityName | null, note?: string): Promise<void> {
  const rights = await ctx.permissions.listRights();
  const view = rightsView(rights, selected, note);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}
