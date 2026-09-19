// Buttons of the `/игры` panel (decision 008 §1–§3): create a game, open settings, toggle the
// move-to-voice setting.
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { Capability } from '../../modules/permissions/service.js';
import { actorOf } from '../member.js';
import { requireSettingsRight, showSettings } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { creationModal, setupCategoryView } from '../views/matches.js';

type Route = ComponentRoute<ButtonInteraction>;

/**
 * `kp1:mnew` — ➕ Создать игру. Modal mode (008 §3): not deferred, because the modal must be the
 * first response. Rights, then games and settings — then showModal, nothing slower in between.
 */
export const newGameButton: Route = {
  defer: 'modal',
  async run(interaction, _args, ctx) {
    const actor = await actorOf(interaction);
    if (!(await ctx.permissions.can(actor, Capability.ACTIVITY_CREATE))) throw new DomainError('NOT_ALLOWED', 'create');
    const [games, settings] = await Promise.all([ctx.games.listEnabled(), ctx.settings.get()]);
    if (!settings.defaultVoiceCategoryId) {
      // The category is picked once; only someone who may change settings can pick it.
      if (!(await ctx.permissions.can(actor, Capability.SETTINGS_MANAGE))) throw new DomainError('SETUP_REQUIRED');
      await interaction.reply({ ...setupCategoryView(false), flags: MessageFlags.Ephemeral });
      return;
    }
    if (games.length === 0) throw new DomainError('NOT_FOUND', 'no enabled games');
    await interaction.showModal(creationModal(games, settings.defaultRecruitChannelId));
  },
};

/** `kp1:mset` — ⚙️ Настройки. */
export const settingsButton: Route = {
  defer: 'ephemeral',
  async run(interaction, _args, ctx) {
    await requireSettingsRight(interaction, ctx);
    await showSettings(interaction, ctx);
  },
};

/** `kp1:smove` — move players into their team channel when a match starts: yes / no. */
export const autoMoveButton: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const next = !(await ctx.settings.get()).autoMoveToVoice;
    await ctx.settings.update({ autoMoveToVoice: next });
    await ctx.logging.event(
      'settings.auto_move',
      { autoMoveToVoice: next, actorId: actor.userId },
      `⚙️ <@${actor.userId}> ${next ? 'включил' : 'выключил'} перенос игроков в голосовые каналы команд.`,
    );
    await showSettings(interaction, ctx, next ? '✅ Игроки будут переноситься в голосовые каналы команд.' : '✅ Перенос в голосовые выключен.');
  },
};
