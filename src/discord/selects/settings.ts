// The `/игры` settings screen (decisions 008 §2, 009 §5): the recruit channel, the voice
// category, the recruit timeout. A channel is saved only when the bot holds what it needs there.
import type { AnySelectMenuInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { RECRUIT_TIMEOUT_CHOICES } from '../../modules/settings/service.js';
import { requireSettingsRight, showSettings } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { setupCategoryView } from '../views/matches.js';

type Route = ComponentRoute<AnySelectMenuInteraction>;

function picked(interaction: AnySelectMenuInteraction): string {
  const id = interaction.values[0];
  if (!id) throw new DomainError('STALE_PANEL', 'empty selection');
  return id;
}

/** `kp1:ssrc` — the default recruit channel. */
export const recruitChannelSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const id = picked(interaction);
    const missing = (await ctx.gateway.checkRecruitChannel(id)).map((p) => `recruit:${p}`);
    if (missing.length > 0) throw new DomainError('BOT_MISSING_PERMISSIONS', missing.join(','), { missing });
    await ctx.settings.update({ defaultRecruitChannelId: id });
    await ctx.logging.event('settings.recruit_channel', { channelId: id, actorId: actor.userId }, `⚙️ <@${actor.userId}> выбрал канал для наборов: <#${id}>.`);
    await showSettings(interaction, ctx, `✅ Наборы будут публиковаться в <#${id}>.`);
  },
};

/** `kp1:svc[:n]` — the voice category; `n` = picked from «➕ Создать игру», continue there. */
export const voiceCategorySelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const id = picked(interaction);
    const missing = (await ctx.gateway.checkVoiceCategory(id)).map((p) => `voice:${p}`);
    if (missing.length > 0) throw new DomainError('BOT_MISSING_PERMISSIONS', missing.join(','), { missing });
    await ctx.settings.update({ defaultVoiceCategoryId: id });
    await ctx.logging.event('settings.voice_category', { categoryId: id, actorId: actor.userId }, `⚙️ <@${actor.userId}> выбрал категорию голосовых каналов: <#${id}>.`);
    if (args[0] === 'n') {
      const view = setupCategoryView(true);
      await interaction.editReply({ embeds: view.embeds, components: view.components });
      return;
    }
    await showSettings(interaction, ctx, `✅ Голосовые каналы команд будут создаваться в <#${id}>.`);
  },
};

/** `kp1:stmo` — close an unfilled recruitment after N hours; 0 = never (009 §5). */
export const recruitTimeoutSelect: Route = {
  defer: 'update',
  async run(interaction, _args, ctx) {
    const actor = await requireSettingsRight(interaction, ctx);
    const hours = Number(picked(interaction));
    if (!(RECRUIT_TIMEOUT_CHOICES as readonly number[]).includes(hours)) throw new DomainError('STALE_PANEL', `hours ${hours}`);
    await ctx.settings.update({ recruitTimeoutHours: hours });
    const text = hours === 0 ? 'никогда (только вручную)' : `через ${hours} ч`;
    await ctx.logging.event(
      'settings.recruit_timeout',
      { recruitTimeoutHours: hours, actorId: actor.userId },
      `⚙️ <@${actor.userId}>: незаполненный набор закрывается ${text}.`,
    );
    await showSettings(interaction, ctx, `✅ Незаполненный набор закрывается ${text}.`);
  },
};
