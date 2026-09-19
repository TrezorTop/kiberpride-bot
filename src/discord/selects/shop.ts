// Select menus of the shop, the clan and room panels and the shop settings (decisions 014 §7,
// §10, 015). Bots picked in a user select are refused here — only this layer knows who is a bot —
// and the services refuse fake ids and the owner themself.
import type { AnySelectMenuInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { intArg, snowflakeArg } from '../customId.js';
import { displayNames } from '../member.js';
import { idArg, requireSettingsRight } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { showClanPanel, showRoomPanel, showShopSettings } from '../shopScreens.js';
import { addOutcomeNote, quoteView } from '../views/shop.js';

type Route = ComponentRoute<AnySelectMenuInteraction>;

function first(interaction: AnySelectMenuInteraction): string {
  const value = interaction.values[0];
  if (!value) throw new DomainError('STALE_PANEL', 'empty selection');
  return value;
}

/** Real people from a user select; bots go straight to the refused list. */
function pickedPeople(interaction: AnySelectMenuInteraction): { ids: string[]; bots: string[] } {
  if (!interaction.isUserSelectMenu()) throw new DomainError('STALE_PANEL', 'not a user select');
  const ids: string[] = [];
  const bots: string[] = [];
  for (const user of interaction.users.values()) (user.bot ? bots : ids).push(user.id);
  return { ids, bots };
}

/** `kp1:shsel` — a good picked in /магазин: the confirm screen with the price and the end date. */
export const goodSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const goodId = intArg(first(interaction));
    if (goodId === null) throw new DomainError('STALE_PANEL', 'bad good id');
    await interaction.editReply(quoteView(await ctx.shop.quote(interaction.user.id, goodId)));
  },
};

/** `kp1:cladd` — ➕ Добавить в клан. */
export const clanAddSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const { ids, bots } = pickedPeople(interaction);
    const outcome = await ctx.clans.addMembers(interaction.user.id, ids);
    const refused = [...outcome.refused, ...bots.map((userId) => ({ userId, code: 'INVALID_TARGET' }))];
    const names = await displayNames(interaction, refused.map((r) => r.userId));
    await showClanPanel(interaction, ctx, addOutcomeNote(outcome.added, refused, names));
  },
};

/** `kp1:clrm` — ➖ Убрать из клана. */
export const clanRemoveSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const userId = snowflakeArg(first(interaction));
    if (!userId) throw new DomainError('STALE_PANEL', 'bad user');
    await ctx.clans.removeMember(interaction.user.id, userId);
    await showClanPanel(interaction, ctx, `➖ <@${userId}> больше не в клане.`);
  },
};

/** `kp1:rmlim` — 👥 how many seats the room has. */
export const roomLimitSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const limit = Number(first(interaction));
    await ctx.rooms.update(interaction.user.id, { userLimit: limit });
    await showRoomPanel(interaction, ctx, limit === 0 ? '👥 Мест без ограничения.' : `👥 Мест в комнате: ${limit}.`);
  },
};

/** `kp1:rmadd` — ➕ Пустить в комнату. */
export const roomAddSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const { ids, bots } = pickedPeople(interaction);
    const outcome = await ctx.rooms.addGuests(interaction.user.id, ids);
    const refused = [...outcome.refused, ...bots.map((userId) => ({ userId, code: 'INVALID_TARGET' }))];
    const names = await displayNames(interaction, refused.map((r) => r.userId));
    await showRoomPanel(interaction, ctx, addOutcomeNote(outcome.added, refused, names));
  },
};

/** `kp1:rmrm` — ➖ Убрать гостя (and disconnect them). */
export const roomRemoveSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const userId = snowflakeArg(first(interaction));
    if (!userId) throw new DomainError('STALE_PANEL', 'bad user');
    await ctx.rooms.removeGuest(interaction.user.id, userId);
    await showRoomPanel(interaction, ctx, `➖ <@${userId}> больше не гость комнаты.`);
  },
};

// ─── Shop settings (SETTINGS_MANAGE, checked again in the service) ──────────

/** `kp1:shch:<goodId>` — the channels where media access works (0..25). */
export const accessChannelsSelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const goodId = idArg(args[0]);
    const view = await ctx.shop.configure(actor, goodId, { channelIds: [...interaction.values] });
    const note = view.problems.length > 0 ? '💾 Каналы сохранены, но товар пока не готов — смотри ⚠️ ниже.' : '✅ Каналы сохранены, права в них настроены.';
    await showShopSettings(interaction, ctx, actor, { fresh: view, note });
  },
};

/** `kp1:shcat:<goodId>` — the category personal rooms are created in. */
export const roomCategorySelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const view = await ctx.shop.configure(actor, idArg(args[0]), { categoryId: first(interaction) });
    await showShopSettings(interaction, ctx, actor, { fresh: view, note: view.problems.length > 0 ? '💾 Категория сохранена — смотри ⚠️ ниже.' : '✅ Категория для комнат сохранена.' });
  },
};

/** `kp1:shanc:<goodId>` — the role clan roles go directly below (decision 015 §4). */
export const clanAnchorSelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const view = await ctx.shop.configure(actor, idArg(args[0]), { anchorRoleId: first(interaction) });
    await showShopSettings(interaction, ctx, actor, {
      fresh: view,
      note: view.problems.length > 0 ? '💾 Роль сохранена — смотри ⚠️ ниже.' : '✅ Клановые роли будут стоять сразу под этой ролью.',
    });
  },
};

/** `kp1:shgs` — a good picked on the settings screen: shows its switch. */
export const settingsGoodSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    await showShopSettings(interaction, ctx, actor, { selectedId: idArg(first(interaction)) });
  },
};
