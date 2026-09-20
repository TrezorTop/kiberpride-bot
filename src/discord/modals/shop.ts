// Modals of the shop (decision 014 §3.2, §3.3, §10): a new clan (`shclan:<goodId>`), a clan
// rename (`clrenf`) and a room rename (`rmnamef`). The palette choice travels as an index, the
// name as typed; the services normalise and check both.
import type { ModalSubmitInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { snowflakeArg } from '../customId.js';
import { actorOf } from '../member.js';
import { idArg, versionOf } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { renderRoomPanel, showClanPanel } from '../shopScreens.js';
import { buyResultView, CLAN_FIELDS, grantGoodResultView, ROOM_FIELDS } from '../views/shop.js';

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

/**
 * `kp1:shgcl:<goodId>:<userId>:<days>` — an administrator hands a clan to a player: the same form
 * the shop uses, and the same name rules (decision 024 §1). SHOP_MANAGE is checked in the service.
 */
export const grantClanModal: Route = {
  defer: 'ephemeral',
  async run(interaction, args, ctx) {
    const userId = snowflakeArg(args[1]);
    if (!userId) throw new DomainError('STALE_PANEL', 'bad player id');
    const result = await ctx.shop.grantByAdmin(await actorOf(interaction), {
      userId,
      goodId: idArg(args[0]),
      days: versionOf(args[2]),
      clan: clanFields(interaction),
    });
    await interaction.editReply(grantGoodResultView(result));
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

/** `kp1:rmnamef:<roomId>` — the room's owner, or an administrator, renames it (024 §4). */
export const roomRenameModal: Route = {
  defer: 'ephemeral',
  async run(interaction, args, ctx) {
    const room = await ctx.rooms.update(await actorOf(interaction), idArg(args[0]), { name: interaction.fields.getTextInputValue(ROOM_FIELDS.name) });
    await renderRoomPanel(interaction, ctx, room, `✏️ Комната теперь называется «${room.name}».`);
  },
};
