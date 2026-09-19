// Select menus of the matches flow (decisions 004 §4, 008 §1, §6, 009 §3).
import type { AnySelectMenuInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { snowflakeArg } from '../customId.js';
import { actorOf } from '../member.js';
import { expectState, idArg, managedMatch, showPanel, versionOf } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { finishConfirmView, NO_MVP, winnerFromArg } from '../views/matches.js';

type Route = ComponentRoute<AnySelectMenuInteraction>;

function userValue(value: string | undefined): string {
  const id = snowflakeArg(value);
  if (!id) throw new DomainError('STALE_PANEL', `bad user ${value}`);
  return id;
}

/** `kp1:mopen` — the open-matches select of `/игры`: opens that match's panel. */
export const openMatchSelect: Route = {
  defer: 'update',
  run: (interaction, _args, ctx) => showPanel(interaction, ctx, idArg(interaction.values[0])),
};

/** `kp1:mrm:<id>` — ➖ remove a player (RECRUITING, TEAMS_PENDING; the service guards it). */
export const removePlayerSelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    await ctx.matches.removeParticipant(await actorOf(interaction), id, userValue(interaction.values[0]));
    await showPanel(interaction, ctx, id, '➖ Игрок убран из состава.');
  },
};

/** `kp1:mteam:<id>` — the exact-size 🔵 Команда A picker; everyone else is team B (008 §6). */
export const teamPickerSelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    await ctx.matches.assignTeamA(await actorOf(interaction), id, interaction.values.map(userValue));
    await showPanel(interaction, ctx, id, '🔵 Команда A сохранена, остальные — в 🔴 B. Проверь составы и жми «✅ Подтвердить команды».');
  },
};

/** `kp1:mmvp:<id>:<v>:<A|B|D>` — step 3 of the finish: the MVP or «Без MVP», then confirm. */
export const mvpSelect: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const winner = winnerFromArg(args[2]);
    if (!winner) throw new DomainError('STALE_PANEL', 'bad winner');
    const picked = interaction.values[0];
    const mvpUserId = picked === NO_MVP ? null : userValue(picked);
    const { match } = await managedMatch(interaction, ctx, idArg(args[0]));
    expectState(match, 'IN_PROGRESS', versionOf(args[1]));
    if (mvpUserId !== null && !match.participants.some((p) => p.userId === mvpUserId && p.team !== null)) {
      throw new DomainError('NOT_A_PARTICIPANT', `mvp ${mvpUserId}`);
    }
    await interaction.editReply(finishConfirmView(match, winner, mvpUserId));
  },
};
