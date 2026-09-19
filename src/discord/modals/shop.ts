// Modals of the shop (decision 014 §3.2, §3.3, §10): a new clan (`shclan:<goodId>`), a clan
// rename (`clrenf`) and a room rename (`rmnamef`). The palette choice travels as an index, the
// name as typed; the services normalise and check both.
import type { ModalSubmitInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { idArg } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { showClanPanel, showRoomPanel } from '../shopScreens.js';
import { buyResultView, CLAN_FIELDS, ROOM_FIELDS } from '../views/shop.js';

type Route = ComponentRoute<ModalSubmitInteraction>;

function clanFields(interaction: ModalSubmitInteraction): { name: string; colorIndex: number } {
  const name = interaction.fields.getTextInputValue(CLAN_FIELDS.name);
  const colorIndex = Number(interaction.fields.getStringSelectValues(CLAN_FIELDS.color)[0] ?? 'x');
  if (!Number.isInteger(colorIndex) || colorIndex < 0) throw new DomainError('STALE_PANEL', 'bad colour');
  return { name, colorIndex };
}

/** `kp1:shclan:<goodId>` — buy the clan with this name and colour. */
export const newClanModal: Route = {
  defer: 'ephemeral',
  async run(interaction, args, ctx) {
    const result = await ctx.shop.buy(interaction.user.id, idArg(args[0]), 0, { clan: clanFields(interaction) });
    await interaction.editReply(buyResultView(result));
  },
};

/** `kp1:clrenf` — the owner renames and recolours the clan. */
export const clanRenameModal: Route = {
  defer: 'ephemeral',
  async run(interaction, _args, ctx) {
    const clan = await ctx.clans.restyle(interaction.user.id, clanFields(interaction));
    await showClanPanel(interaction, ctx, `✏️ Теперь клан называется «${clan.name}».`);
  },
};

/** `kp1:rmnamef` — the owner renames the room. */
export const roomRenameModal: Route = {
  defer: 'ephemeral',
  async run(interaction, _args, ctx) {
    const room = await ctx.rooms.update(interaction.user.id, { name: interaction.fields.getTextInputValue(ROOM_FIELDS.name) });
    await showRoomPanel(interaction, ctx, `✏️ Комната теперь называется «${room.name}».`);
  },
};
