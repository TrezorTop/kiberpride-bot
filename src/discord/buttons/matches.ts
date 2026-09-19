// Buttons of the matches flow (decisions 004 §4, 008 §4, §6, §10, 009 §1). Each one: parse the
// custom_id, call one service method, render a view. Join and leave defer as `update` on the
// public message and confirm privately; the recruitment message itself is redrawn by sync.
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import type { JoinResult } from '../../modules/matches/service.js';
import { mayAddTestPlayers } from '../../modules/matches/testPlayers.js';
import { snowflakeArg } from '../customId.js';
import { actorOf, displayNames } from '../member.js';
import { expectState, idArg, managedMatch, showPanel, versionOf } from '../panels.js';
import type { ComponentRoute } from '../router.js';
import { cancelConfirmView, cancelledView, finishedView, mvpView, NO_MVP, winnerFromArg, winnerView } from '../views/matches.js';

type Route = ComponentRoute<ButtonInteraction>;

function joinedText(r: JoinResult): string {
  if (r.status === 'RECRUITING') return `Ты в игре! 🎮 Участников: ${r.participantCount}/${r.capacity}. Передумаешь — жми «❌ Покинуть игру».`;
  if (r.status === 'TEAMS_PENDING') return 'Ты в игре — состав собран! 🎉 Организатор распределяет команды, скоро позовём.';
  return 'Ты в игре — состав собран, команды готовы! 🎉 Смотри составы и голосовой канал в сообщении набора.';
}

/** `kp1:mjoin:<id>` — 🎮 Участвовать. */
export const joinButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const result = await ctx.matches.join(idArg(args[0]), interaction.user.id);
    await interaction.followUp({ content: joinedText(result), flags: MessageFlags.Ephemeral });
  },
};

/** `kp1:mleave:<id>` — ❌ Покинуть игру. */
export const leaveButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    await ctx.matches.leave(idArg(args[0]), interaction.user.id);
    await interaction.followUp({ content: 'Ты вышел из набора. Возвращайся, если передумаешь 🙂', flags: MessageFlags.Ephemeral });
  },
};

/** `kp1:mpan:<id>` — ⚙️ Управление / 🔧 Распределить команды: the private match panel. */
export const panelButton: Route = {
  defer: 'ephemeral',
  run: (interaction, args, ctx) => showPanel(interaction, ctx, idArg(args[0])),
};

/** `kp1:mfin:<id>` — 🏁 Завершить матч: step 1, the winner. */
export const finishButton: Route = {
  defer: 'ephemeral',
  async run(interaction, args, ctx) {
    const { match } = await managedMatch(interaction, ctx, idArg(args[0]));
    expectState(match, 'IN_PROGRESS', null);
    await interaction.editReply(winnerView(match));
  },
};

/** `kp1:mwin:<id>:<v>:<A|B|D>` — step 2, the MVP select (with «Без MVP» first). */
export const winnerButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const winner = winnerFromArg(args[2]);
    if (!winner) throw new DomainError('STALE_PANEL', 'bad winner');
    const { match } = await managedMatch(interaction, ctx, idArg(args[0]));
    expectState(match, 'IN_PROGRESS', versionOf(args[1]));
    const names = await displayNames(
      interaction,
      match.participants.map((p) => p.userId),
    );
    await interaction.editReply(mvpView(match, winner, names));
  },
};

/** `kp1:mcfm:<id>:<v>:<A|B|D>:<mvpUserId|0>` — step 4, the one finish transaction. */
export const confirmFinishButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    const winner = winnerFromArg(args[2]);
    const mvpUserId = args[3] === NO_MVP ? null : snowflakeArg(args[3]);
    if (!winner || (args[3] !== NO_MVP && mvpUserId === null)) throw new DomainError('STALE_PANEL', 'bad finish args');
    await ctx.matches.finish(await actorOf(interaction), { id, version: versionOf(args[1]), winner, mvpUserId });
    await interaction.editReply(finishedView(await ctx.matches.get(id)));
  },
};

/** `kp1:mcan:<id>:<v>` — 🚫 Отменить матч: asks first. */
export const cancelButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const { match } = await managedMatch(interaction, ctx, idArg(args[0]));
    expectState(match, match.status, versionOf(args[1]));
    await interaction.editReply(cancelConfirmView(match));
  },
};

/** `kp1:mccf:<id>:<v>` — 🚫 Да, отменить. */
export const confirmCancelButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    await ctx.matches.cancel(await actorOf(interaction), id, versionOf(args[1]));
    await interaction.editReply(cancelledView(await ctx.matches.get(id)));
  },
};

/** `kp1:mtok:<id>:<v>` — ✅ Подтвердить команды. */
export const confirmTeamsButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    await ctx.matches.confirmTeams(await actorOf(interaction), id, versionOf(args[1]));
    await showPanel(interaction, ctx, id, '✅ Команды подтверждены — матч начался! Игроки получат приглашение в голосовые каналы.');
  },
};

/** `kp1:mspc:<id>:<1|0>` — ⭐ Особый матч ×2 on/off (decision 009 §1). */
export const specialButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    const on = args[1] === '1';
    await ctx.matches.setSpecial(await actorOf(interaction), id, on);
    await showPanel(interaction, ctx, id, on ? '⭐ Теперь это особый матч — все награды ×2.' : 'Матч снова обычный — награды как в настройках.');
  },
};

/** `kp1:mtest:<id>` — 🧪 Добавить тестовых игроков: owner only, never in production (008 §10). */
export const testPlayersButton: Route = {
  defer: 'update',
  async run(interaction, args, ctx) {
    const id = idArg(args[0]);
    const actor = await actorOf(interaction);
    if (!mayAddTestPlayers(actor, ctx.nodeEnv)) throw new DomainError('NOT_ALLOWED', 'test players');
    const added = await ctx.matches.addTestPlayers(actor, id);
    await showPanel(
      interaction,
      ctx,
      id,
      `🧪 Добавлено тестовых игроков: ${added}. Нажми «🎮 Участвовать» в сообщении набора — твоё место закроет состав.`,
    );
  },
};
