// Shared steps of the organiser handlers: parse ids from a custom_id, load the match, check the
// right to manage it, render the panel. Handlers stay one service call plus a view (002 §3);
// the services re-check rights themselves (008 §6), these checks only pick the right screen.
import type { AnySelectMenuInteraction, ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { DomainError } from '../core/errors.js';
import type { MatchSnapshot, MatchStatusName } from '../core/match.js';
import { mayAddTestPlayers } from '../modules/matches/testPlayers.js';
import { Capability, type MemberFacts } from '../modules/permissions/service.js';
import { intArg, versionArg } from './customId.js';
import { actorOf, displayNames } from './member.js';
import type { AppContext } from './router.js';
import { matchPanelView, settingsView } from './views/matches.js';

type Component = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

/** A malformed id in a custom_id is a stale or forged button, never a crash. */
export function idArg(value: string | undefined): number {
  const id = intArg(value);
  if (id === null) throw new DomainError('STALE_PANEL', `bad id ${value}`);
  return id;
}

export function versionOf(value: string | undefined): number {
  const v = versionArg(value);
  if (v === null) throw new DomainError('STALE_PANEL', `bad version ${value}`);
  return v;
}

/**
 * A `<1|0>` choice from a custom_id. Never `value === '1'`: a panel drawn by an older deploy can
 * carry one argument fewer, and then the flag reads as absent — «открыть комнату для всех»,
 * «снять без возврата» — on a row the presser never chose. Anything but an explicit 0 or 1 is a
 * stale panel (architect review 2026-09-20, M2).
 */
export function flagOf(value: string | undefined): boolean {
  if (value !== '0' && value !== '1') throw new DomainError('STALE_PANEL', `bad flag ${value}`);
  return value === '1';
}

/** The match, if the presser may manage it (creator or MATCH_MANAGE_ANY). */
export async function managedMatch(interaction: Component, ctx: AppContext, id: number): Promise<{ actor: MemberFacts; match: MatchSnapshot }> {
  const actor = await actorOf(interaction);
  const match = await ctx.matches.get(id);
  if (!(await ctx.permissions.canManageMatch(actor, match))) throw new DomainError('NOT_ALLOWED', `panel of match ${id}`);
  return { actor, match };
}

/** The screen a finish/cancel step expects; anything else means the panel is old. */
export function expectState(match: MatchSnapshot, status: MatchStatusName, version: number | null): void {
  if (match.status === 'FINISHED') throw new DomainError('MATCH_ALREADY_FINISHED');
  if (match.status === 'CANCELLED') throw new DomainError('MATCH_CANCELLED');
  if (match.status !== status) {
    throw new DomainError(status === 'IN_PROGRESS' && match.status !== 'IN_PROGRESS' ? 'TEAMS_NOT_READY' : 'STALE_PANEL');
  }
  if (version !== null && match.version !== version) throw new DomainError('STALE_PANEL');
}

/** Renders the organiser panel into the deferred reply (ephemeral or the pressed panel). */
export async function showPanel(interaction: Component, ctx: AppContext, id: number, note?: string): Promise<void> {
  const { actor, match } = await managedMatch(interaction, ctx, id);
  // Opening the panel also repairs a match whose last sync failed (decision 004 §6).
  if (match.syncedVersion < match.version) void ctx.matches.enqueueSync(id);
  const names = await displayNames(
    interaction,
    match.participants.map((p) => p.userId),
  );
  const view = matchPanelView(match, names, { canTest: mayAddTestPlayers(actor, ctx.nodeEnv) }, note);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}

export async function requireSettingsRight(interaction: Component, ctx: AppContext): Promise<MemberFacts> {
  const actor = await actorOf(interaction);
  if (!(await ctx.permissions.can(actor, Capability.SETTINGS_MANAGE))) throw new DomainError('NOT_ALLOWED', 'settings');
  return actor;
}

export async function showSettings(interaction: Component, ctx: AppContext, note?: string): Promise<void> {
  const [settings, defaults] = await Promise.all([ctx.settings.get(), ctx.rewards.defaults()]);
  const view = settingsView(settings, defaults, note);
  await interaction.editReply({ content: null, embeds: view.embeds, components: view.components });
}
