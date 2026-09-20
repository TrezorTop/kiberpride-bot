// Buttons of the shop, the clan and room panels, the profile and the shop settings (decision 014
// §10, §12). Each one: parse the custom_id, call one service method, render a view.
import type { ButtonInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { mayUseDevTools } from '../../modules/permissions/devTools.js';
import { actorOf } from '../member.js';
import { idArg, requireSettingsRight, showSettings, versionOf } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { displayNameOf, showClanPanel, showRoomPanel, showShopSettings } from '../shopScreens.js';
import { buyResultView, clanModal, dailyClaimedEmbed, enableRefusedNote, purchasesView, revokeResultView, roomNameModal } from '../views/shop.js';
import { formatKp } from '../views/format.js';
import { noticeEmbed } from '../views/style.js';

type Route = ComponentRoute<ButtonInteraction>;

/** `kp1:shbuy:<goodId>:<expectedPeriods>` — ✅ Купить / 🔁 Продлить; 0 = a new purchase (014 §1). */
export const buyButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const result = await ctx.shop.buy(interaction.user.id, idArg(args[0]), versionOf(args[1]), { roomName: `🏠 ${displayNameOf(interaction)}` });
    await interaction.editReply(buyResultView(result));
  },
};

/** `kp1:shcnew:<goodId>` — a new clan: the name-and-colour modal first (modal mode, 008 §3). */
export const newClanButton: Route = {
  defer: 'modal',
  async run(interaction, args, ctx) {
    const goodId = idArg(args[0]);
    const quote = await ctx.shop.quote(interaction.user.id, goodId);
    if (!quote.clanForm || !quote.palette) throw new DomainError('STALE_PANEL', `good ${goodId} is not a new clan`);
    if (quote.shortBy > 0) throw new DomainError('INSUFFICIENT_FUNDS', `short by ${quote.shortBy}`);
    await interaction.showModal(clanModal(quote.palette, { goodId }));
  },
};

/** `kp1:clan` — 🛡️ Мой клан. */
export const clanButton: Route = { defer: 'ephemeral', run: (interaction, _args, ctx) => showClanPanel(interaction, ctx) };

/** `kp1:clren` — ✏️ Название и цвет (owner): the same form, filled in (modal mode). */
export const clanRenameButton: Route = {
  defer: 'modal',
  async run(interaction, _args, ctx) {
    const clan = await ctx.clans.forUser(interaction.user.id);
    if (!clan) throw new DomainError('NO_CLAN', interaction.user.id);
    if (!clan.isOwner) throw new DomainError('NOT_OWNER', interaction.user.id);
    await interaction.showModal(clanModal(clan.palette, { rename: true }, { name: clan.name, color: clan.color }));
  },
};

/** `kp1:clleave` — 🚪 Выйти из клана (a member). */
export const clanLeaveButton: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    await ctx.clans.leave(interaction.user.id);
    await interaction.editReply({ embeds: [noticeEmbed('Ты вышел из клана. Роль уберётся через пару секунд.', '🚪 Готово')], components: [] });
  },
};

/** `kp1:room` — 🏠 Моя комната. */
export const roomButton: Route = { defer: 'ephemeral', run: (interaction, _args, ctx) => showRoomPanel(interaction, ctx) };

/** `kp1:rmname` — ✏️ Название комнаты (modal mode). */
export const roomRenameButton: Route = {
  defer: 'modal',
  async run(interaction, _args, ctx) {
    const room = await ctx.rooms.forOwner(interaction.user.id);
    if (!room) throw new DomainError('NO_ROOM', interaction.user.id);
    await interaction.showModal(roomNameModal(room.name));
  },
};

/** `kp1:rmlock:<1|0>` — 🔒 закрыть / 🔓 открыть комнату. */
export const roomLockButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const locked = args[0] === '1';
    await ctx.rooms.update(interaction.user.id, { locked });
    await showRoomPanel(interaction, ctx, locked ? '🔒 Комната закрыта: заходят только ты и гости.' : '🔓 Комната открыта для всех.');
  },
};

/** `kp1:mybuy` — 🛍️ Мои покупки. */
export const myPurchasesButton: Route = {
  defer: 'ephemeral',
  async run(interaction, _args, ctx) {
    const [grants, actor] = await Promise.all([ctx.shop.grants(interaction.user.id), actorOf(interaction)]);
    await interaction.editReply(purchasesView(grants, new Date(), { dev: mayUseDevTools(actor, ctx.nodeEnv) }));
  },
};

/** `kp1:dexp:<purchaseId>` — 🧪 Закончить через 2 минуты (owner, test server only; 014 §12). */
export const devExpireButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await actorOf(interaction);
    if (!mayUseDevTools(actor, ctx.nodeEnv)) throw new DomainError('NOT_ALLOWED', 'dev expire');
    const at = await ctx.shop.devExpireSoon(actor, idArg(args[0]));
    const grants = await ctx.shop.grants(interaction.user.id);
    await interaction.editReply(
      purchasesView(grants, new Date(), { dev: true }, `🧪 Закончится <t:${Math.floor(at.getTime() / 1000)}:R>. Предупреждение придёт в личку в течение минуты.`),
    );
  },
};

/** `kp1:dtop:<nonce>` — 🧪 +10 000 KP Coin (owner, test server only; 014 §12). */
export const devTopUpButton: Route = {
  defer: 'ephemeral',
  async run(interaction, args, ctx) {
    const actor = await actorOf(interaction);
    if (!mayUseDevTools(actor, ctx.nodeEnv)) throw new DomainError('NOT_ALLOWED', 'dev top-up');
    const nonce = args[0];
    if (!nonce) throw new DomainError('STALE_PANEL', 'no nonce');
    const r = await ctx.economy.devTopUp(actor, nonce, ctx.nodeEnv);
    const text = r.applied ? `🧪 +10 000 KP Coin зачислено. Баланс: ${formatKp(r.entry.balanceAfter)}` : '🧪 Это пополнение уже зачислено — открой /профиль заново, чтобы получить ещё.';
    await interaction.editReply({ embeds: [noticeEmbed(text)] });
  },
};

/** `kp1:daily` — 🎁 Ежедневный бонус from /профиль. */
export const dailyButton: Route = {
  defer: 'ephemeral',
  async run(interaction, _args, ctx) {
    const r = await ctx.earnings.claimDaily(interaction.user.id);
    await interaction.editReply({ embeds: [dailyClaimedEmbed(r.amount, r.balanceAfter, r.nextAt)] });
  },
};

/**
 * `kp1:rvk:<purchaseId>:<periods>:<1|0>` — 🚫 Снять без возврата / ↩️ Снять и вернуть монеты
 * (decision 023 §1). The id carries the period count as the guard, never an amount (002 §4);
 * SHOP_MANAGE is checked in the service.
 */
export const revokeButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await actorOf(interaction);
    const result = await ctx.shop.revoke(actor, { purchaseId: idArg(args[0]), expectedPeriods: versionOf(args[1]), refund: args[2] === '1' });
    await interaction.editReply(revokeResultView(result));
  },
};

/** `kp1:sshop` — 🛒 Магазин on the /игры settings screen (SETTINGS_MANAGE; 014 §7). */
export const shopSettingsButton: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    await showShopSettings(interaction, ctx, actor);
  },
};

/** `kp1:ssback` — ⬅️ back to the games settings. */
export const settingsBackButton: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    await requireSettingsRight(interaction, ctx);
    await showSettings(interaction, ctx);
  },
};

/** `kp1:shen:<goodId>:<1|0>` — ✅ Включить / ⛔ Выключить; enabling is refused while problems remain. */
export const enableGoodButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const goodId = idArg(args[0]);
    const want = args[1] === '1';
    const result = await ctx.shop.setEnabled(actor, goodId, want);
    const note =
      want && !result.enabled
        ? enableRefusedNote(result.good.name, result.problems)
        : want
          ? `✅ «${result.good.name}» включён — игроки видят его в /магазин.`
          : `⛔ «${result.good.name}» выключен. Уже купленное доработает свой срок.`;
    await showShopSettings(interaction, ctx, actor, { selectedId: goodId, fresh: result, note });
  },
};
