// Shared steps of the shop and profile handlers (decision 014 §10): load through one service,
// render one view into the deferred reply. Services re-check rights and ownership themselves.
import { randomBytes } from 'node:crypto';
import type { AnySelectMenuInteraction, ButtonInteraction, ChatInputCommandInteraction, Interaction, ModalSubmitInteraction } from 'discord.js';
import { DomainError } from '../core/errors.js';
import { mayUseDevTools } from '../modules/permissions/devTools.js';
import type { MemberFacts } from '../modules/permissions/service.js';
import type { RoomView } from '../modules/shop/room.js';
import type { GoodAdminView } from '../modules/shop/service.js';
import { actorOf, displayNames } from './member.js';
import type { AppContext } from './router.js';
import { PROFILE_HISTORY_LIMIT, profileView } from './views/profile.js';
import { clanPanelView, dailyStatusLine, roomPanelView, shopSettingsView, shopView } from './views/shop.js';

type Answerable = ChatInputCommandInteraction | ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

/** The name a new personal room starts with; the owner renames it in the panel. */
export function displayNameOf(interaction: Interaction): string {
  const member = interaction.inCachedGuild() ? interaction.member : null;
  return member?.displayName ?? interaction.user.displayName;
}

export async function showShop(interaction: Answerable, ctx: AppContext, note?: string): Promise<void> {
  const overview = await ctx.shop.overview(interaction.user.id);
  const view = shopView(overview, new Date(), note);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}

export async function showClanPanel(interaction: Answerable, ctx: AppContext, note?: string): Promise<void> {
  const clan = await ctx.clans.forUser(interaction.user.id);
  if (!clan) throw new DomainError('NO_CLAN', `user ${interaction.user.id}`);
  const names = await displayNames(interaction, clan.memberIds);
  const view = clanPanelView(clan, names, new Date(), note);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}

/** The caller's own room; a player without one is told where to get it (NO_ROOM). */
export async function showRoomPanel(interaction: Answerable, ctx: AppContext, note?: string): Promise<void> {
  const room = await ctx.rooms.forOwner(interaction.user.id);
  if (!room) throw new DomainError('NO_ROOM', `user ${interaction.user.id}`);
  await renderRoomPanel(interaction, ctx, room, note);
}

/** A room already loaded — the caller's own, or another player's for an administrator (024 §4). */
export async function renderRoomPanel(interaction: Answerable, ctx: AppContext, room: RoomView, note?: string): Promise<void> {
  const names = await displayNames(interaction, room.guestIds);
  const view = roomPanelView(room, names, new Date(), { note, viewerId: interaction.user.id });
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}

export async function showShopSettings(
  interaction: Answerable,
  ctx: AppContext,
  actor: MemberFacts,
  opts: { selectedId?: number | null; fresh?: GoodAdminView; note?: string } = {},
): Promise<void> {
  const list = (await ctx.shop.adminList(actor)).map((v) => (opts.fresh && v.good.id === opts.fresh.good.id ? opts.fresh : v));
  const view = shopSettingsView(list, opts.selectedId ?? null, opts.note);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}

export async function showProfile(interaction: Answerable, ctx: AppContext): Promise<void> {
  const userId = interaction.user.id;
  const [{ balance }, recent, grants, daily, clan, room, actor] = await Promise.all([
    ctx.economy.ensureUser(userId),
    ctx.economy.history(userId, PROFILE_HISTORY_LIMIT),
    ctx.shop.grants(userId),
    ctx.earnings.dailyStatus(userId),
    ctx.clans.forUser(userId),
    ctx.rooms.forOwner(userId),
    actorOf(interaction),
  ]);
  const member = interaction.inCachedGuild() ? interaction.member : null;
  const view = profileView({
    userId,
    displayName: member?.displayName ?? interaction.user.displayName,
    avatarUrl: (member ?? interaction.user).displayAvatarURL(),
    balance,
    recent,
    grants,
    dailyLine: dailyStatusLine(daily),
    clan: clan ? (clan.isOwner ? 'owner' : 'member') : null,
    hasRoom: room !== null,
    // A fresh nonce per render: pressing the same button twice pays once (014 §12).
    devNonce: mayUseDevTools(actor, ctx.nodeEnv) ? randomBytes(9).toString('base64url') : null,
    now: new Date(),
  });
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}
