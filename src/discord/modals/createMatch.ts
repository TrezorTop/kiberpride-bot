// `kp1:mnewf` — the creation modal is submitted (decision 008 §3). The service re-checks rights,
// the game, the channel's and the category's permissions, snapshots the rewards, and waits for
// the first sync, so the organiser gets a link to the posted recruitment message.
import type { ModalSubmitInteraction } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE } from '../../modules/matches/constants.js';
import { intArg } from '../customId.js';
import { actorOf } from '../member.js';
import type { ComponentRoute } from '../router.js';
import { MODAL_FIELDS } from '../views/matches.js';
import { noticeEmbed } from '../views/style.js';

export const createMatchModal: ComponentRoute<ModalSubmitInteraction> = {
  defer: 'ephemeral',
  async run(interaction, _args, ctx) {
    const fields = interaction.fields;
    const gameId = intArg(fields.getStringSelectValues(MODAL_FIELDS.game)[0]);
    const size = Number(fields.getStringSelectValues(MODAL_FIELDS.size)[0] ?? '0');
    const mode = fields.getStringSelectValues(MODAL_FIELDS.mode)[0] === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const title = fields.getTextInputValue(MODAL_FIELDS.title).trim() || null;
    const channelId = fields.getSelectedChannels(MODAL_FIELDS.channel, true).first()?.id;
    const sizeOk = size === 0 || (Number.isInteger(size) && size >= MIN_TEAM_SIZE && size <= MAX_TEAM_SIZE);
    if (gameId === null || !channelId || !sizeOk) throw new DomainError('STALE_PANEL', 'malformed creation form');

    const { matchId } = await ctx.matches.create(await actorOf(interaction), {
      gameId,
      teamSize: size,
      teamMode: mode,
      title,
      recruitChannelId: channelId,
    });
    const match = await ctx.matches.get(matchId);
    const text = match.recruitMessageId
      ? `Набор открыт: https://discord.com/channels/${interaction.guildId}/${match.recruitChannelId}/${match.recruitMessageId}\nУправлять матчем — кнопка «⚙️ Управление» под сообщением набора или /игры.`
      : `Опубликовать набор в <#${match.recruitChannelId}> пока не получилось. Проверь, что бот видит этот канал, и открой матч в /игры — я попробую снова.`;
    await interaction.editReply({ embeds: [noticeEmbed(text, '✅ Игра создана')] });
  },
};
