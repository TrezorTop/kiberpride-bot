// The router (decision 002 §3–4): a map from command name / custom_id action to a thin handler.
// The router defers every interaction BEFORE the handler touches the database, so Discord's
// 3-second window is never at the mercy of a slow query. Unknown ids get «кнопка устарела».
import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type AnySelectMenuInteraction,
} from 'discord.js';
import { isDomainError } from '../core/errors.js';
import type { EconomyService } from '../modules/economy/service.js';
import type { Logger } from '../modules/logging/logger.js';
import type { LoggingService } from '../modules/logging/service.js';
import type { PermissionsService } from '../modules/permissions/service.js';
import { decodeCustomId } from './customId.js';
import { domainErrorText, NOT_READY, STALE_COMPONENT, UNEXPECTED_ERROR, WRONG_GUILD } from './views/messages.js';

/** The guild this deployment serves, discovered at start (src/discord/client.ts). */
export interface GuildBinding {
  id: string | null;
}

export interface AppContext {
  economy: EconomyService;
  permissions: PermissionsService;
  logging: LoggingService;
  logger: Logger;
  guild: GuildBinding;
}

export interface CommandRoute {
  definition: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Runs after the router has deferred an ephemeral reply; answer with editReply. */
  run(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}

/** `ephemeral`: a private answer (editReply). `update`: the pressed message is edited. */
export type DeferMode = 'ephemeral' | 'update';

export interface ComponentRoute<I> {
  defer: DeferMode;
  run(interaction: I, args: string[], ctx: AppContext): Promise<void>;
}

export interface Routes {
  commands: ReadonlyMap<string, CommandRoute>;
  buttons: ReadonlyMap<string, ComponentRoute<ButtonInteraction>>;
  selects: ReadonlyMap<string, ComponentRoute<AnySelectMenuInteraction>>;
  modals: ReadonlyMap<string, ComponentRoute<ModalSubmitInteraction>>;
}

/** Finds the handler for a custom_id; null means stale or foreign (answer «кнопка устарела»). */
export function resolveComponent<I>(
  routes: ReadonlyMap<string, ComponentRoute<I>>,
  customId: string,
): { route: ComponentRoute<I>; args: string[] } | null {
  const decoded = decodeCustomId(customId);
  if (!decoded) return null;
  const route = routes.get(decoded.action);
  return route ? { route, args: decoded.args } : null;
}

type Answerable = ChatInputCommandInteraction | ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

export async function dispatch(interaction: Interaction, routes: Routes, ctx: AppContext): Promise<void> {
  if (!interaction.isRepliable()) return;
  const target = interaction as Answerable;

  if (ctx.guild.id === null) return privateReply(target, NOT_READY, ctx);
  if (interaction.guildId !== ctx.guild.id) return privateReply(target, WRONG_GUILD, ctx);

  if (interaction.isChatInputCommand()) {
    const route = routes.commands.get(interaction.commandName);
    if (!route) return privateReply(interaction, STALE_COMPONENT, ctx);
    return guarded(interaction, 'ephemeral', ctx, () => route.run(interaction, ctx));
  }

  if (interaction.isButton()) return component(interaction, routes.buttons, ctx);
  if (interaction.isAnySelectMenu()) return component(interaction, routes.selects, ctx);
  if (interaction.isModalSubmit()) return component(interaction, routes.modals, ctx);
}

async function component<I extends ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction>(
  interaction: I,
  routes: ReadonlyMap<string, ComponentRoute<I>>,
  ctx: AppContext,
): Promise<void> {
  const found = resolveComponent(routes, interaction.customId);
  if (!found) {
    ctx.logger.info({ customId: interaction.customId, userId: interaction.user.id }, 'stale component');
    return privateReply(interaction, STALE_COMPONENT, ctx);
  }
  return guarded(interaction, found.route.defer, ctx, () => found.route.run(interaction, found.args, ctx));
}

async function guarded(interaction: Answerable, mode: DeferMode, ctx: AppContext, run: () => Promise<void>): Promise<void> {
  try {
    if (mode === 'update' && !interaction.isChatInputCommand()) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await run();
  } catch (err) {
    if (isDomainError(err)) return answerAfterDefer(interaction, mode, domainErrorText(err.code), ctx);
    const where = interaction.isChatInputCommand() ? `/${interaction.commandName}` : interaction.customId;
    ctx.logger.error({ err, where, userId: interaction.user.id }, 'interaction failed');
    await ctx.logging.event(
      'interaction.failed',
      { where, userId: interaction.user.id },
      `⚠️ Ошибка в ${where} у <@${interaction.user.id}> — подробности в логе процесса`,
    );
    return answerAfterDefer(interaction, mode, UNEXPECTED_ERROR, ctx);
  }
}

async function answerAfterDefer(interaction: Answerable, mode: DeferMode, content: string, ctx: AppContext): Promise<void> {
  if (!interaction.deferred && !interaction.replied) return privateReply(interaction, content, ctx);
  try {
    // An `update` defer belongs to the public message; the error goes privately to the presser.
    if (mode === 'update') await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    else await interaction.editReply({ content, embeds: [], components: [] });
  } catch (err) {
    ctx.logger.warn({ err }, 'could not deliver the error message');
  }
}

async function privateReply(interaction: Answerable, content: string, ctx: AppContext): Promise<void> {
  try {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (err) {
    ctx.logger.warn({ err }, 'could not reply');
  }
}
