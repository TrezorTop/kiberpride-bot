// /комната — the personal-room panel, straight from a command (decision 024 §4). Everyone sees
// it: without an option it opens the caller's own room. With a player it opens THAT player's room
// for a holder of SHOP_MANAGE; the right is checked in the room service, not here.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { renderRoomPanel } from '../shopScreens.js';
import { noRoomView } from '../views/shop.js';

/** Option names, in one place: the handler reads exactly what the definition declares. */
export const ROOM_OPTIONS = { user: 'игрок' } as const;

export const roomCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('комната')
    .setDescription('Твоя личная комната: название, места, замок и гости')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName(ROOM_OPTIONS.user).setDescription('Чья комната (только для администраторов)'))
    .toJSON(),

  async run(interaction, ctx) {
    const target = interaction.options.getUser(ROOM_OPTIONS.user);
    const ownerId = target?.id ?? interaction.user.id;
    // Their own id needs no right, so «/комната @сам_себя» behaves like «/комната» (024 §4).
    const room = await ctx.rooms.forPlayer(await actorOf(interaction), ownerId);
    if (room) return renderRoomPanel(interaction, ctx, room);
    // Their own missing room is the familiar «купи в /магазин»; another player's is a plain answer.
    if (ownerId === interaction.user.id) throw new DomainError('NO_ROOM', `user ${ownerId}`);
    await interaction.editReply(noRoomView(ownerId));
  },
};
