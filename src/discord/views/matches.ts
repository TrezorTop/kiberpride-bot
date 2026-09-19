// Every screen of the matches flow (decisions 004 §4, 008 §1–§8, 009): the public recruitment
// message, the ephemeral organiser panels, the finish flow, the announcements and the creation
// modal. Rendered only from a MatchSnapshot; all player text lives here (rule plain-language §8).
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import {
  fakeUserNumber,
  isFakeUserId,
  type MatchSnapshot,
  type MatchStatusName,
  type OpenStatusName,
  type ParticipantSnapshot,
  type RewardAmounts,
  type TeamName,
  type WinnerName,
} from '../../core/match.js';
import type { GameView } from '../../modules/games/service.js';
import { payoutPlan, payoutTotals } from '../../modules/matches/payout.js';
import { DEFAULT_TITLE, MAX_TEAM_SIZE, MAX_TITLE_LENGTH, MIN_TEAM_SIZE } from '../../modules/matches/constants.js';
import { RECRUIT_TIMEOUT_CHOICES, type GuildSettingsView } from '../../modules/settings/service.js';
import { encodeCustomId } from '../customId.js';
import { formatSignedKp } from './format.js';
import { brandEmbed, noticeEmbed } from './style.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
export interface View {
  content?: string;
  embeds: EmbedBuilder[];
  components: Row[];
}
/** userId → display name, for select options (a select cannot render a mention). */
export type Names = ReadonlyMap<string, string>;

export const MODAL_FIELDS = { game: 'game', size: 'size', mode: 'mode', title: 'title', channel: 'chan' } as const;
/** The MVP select's «Без MVP» value, carried as `0` in the confirm custom_id (009 §3). */
export const NO_MVP = '0';

const STATUS_TEXT: Record<MatchStatusName, string> = {
  RECRUITING: 'идёт набор',
  TEAMS_PENDING: 'распределение команд',
  IN_PROGRESS: 'матч идёт',
  FINISHED: 'завершён',
  CANCELLED: 'отменён',
};
const TEAM_TITLE: Record<TeamName, string> = { A: '🔵 Команда A', B: '🔴 Команда B' };
const WINNER_TEXT: Record<WinnerName, string> = { A: '🔵 Команда A', B: '🔴 Команда B', DRAW: '🤝 Ничья' };
export const WINNER_ARG: Record<WinnerName, string> = { A: 'A', B: 'B', DRAW: 'D' };

export function winnerFromArg(arg: string | undefined): WinnerName | null {
  return arg === 'A' ? 'A' : arg === 'B' ? 'B' : arg === 'D' ? 'DRAW' : null;
}

// The status a cancel panel was rendered in, carried in `mcan`/`mccf` (review 2026-09-20).
const OPEN_STATUS_ARG: Partial<Record<MatchStatusName, string>> = { RECRUITING: 'R', TEAMS_PENDING: 'T', IN_PROGRESS: 'P' };

function openStatusArg(status: MatchStatusName): string {
  const arg = OPEN_STATUS_ARG[status];
  if (!arg) throw new Error(`no cancel button in status ${status}`);
  return arg;
}

export function openStatusFromArg(arg: string | undefined): OpenStatusName | null {
  return arg === 'R' ? 'RECRUITING' : arg === 'T' ? 'TEAMS_PENDING' : arg === 'P' ? 'IN_PROGRESS' : null;
}

/** A player as the message shows them; fake players never become mentions (008 §10). */
export function mention(userId: string): string {
  return isFakeUserId(userId) ? `🧪 Тестовый игрок ${fakeUserNumber(userId)}` : `<@${userId}>`;
}

export function nameOf(userId: string, names: Names): string {
  if (isFakeUserId(userId)) return `🧪 Тестовый игрок ${fakeUserNumber(userId)}`;
  return names.get(userId) ?? `Игрок …${userId.slice(-4)}`;
}

const format = (m: Pick<MatchSnapshot, 'teamSize'>) => `${m.teamSize}×${m.teamSize}`;
const heading = (m: MatchSnapshot) => `${m.game.emoji} ${m.game.name} — ${format(m)}`;
const who = (p: ParticipantSnapshot) => `${mention(p.userId)}${p.leftServerAt ? ' (покинул сервер)' : ''}`;
const team = (m: MatchSnapshot, t: TeamName) => m.participants.filter((p) => p.team === t);

function rosterLines(list: ParticipantSnapshot[], empty: string): string {
  return list.length > 0 ? list.map(who).join('\n') : empty;
}

export function rewardsLine(r: RewardAmounts): string {
  const parts = [`участие ${formatSignedKp(r.participation)}`, `победа ${formatSignedKp(r.win)}`, `MVP ${formatSignedKp(r.mvp)}`];
  if (r.draw > 0) parts.push(`ничья ${formatSignedKp(r.draw)}`);
  return parts.join(' · ');
}

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function button(customId: string, label: string, style: ButtonStyle, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

// ─── The public recruitment message (008 §4) ────────────────────────────────

export function recruitmentView(m: MatchSnapshot): View {
  const lines = [`**${m.title}**`];
  if (m.special) lines.push('⭐ Особый матч — награды ×2');
  lines.push(`Команды: ${m.teamMode === 'AUTO' ? 'случайно' : 'выбирает организатор'} · организатор ${mention(m.createdById)}`);
  const statusLine: Record<MatchStatusName, string | null> = {
    RECRUITING: null,
    TEAMS_PENDING: '🔧 Состав собран — организатор распределяет команды.',
    IN_PROGRESS: '🎮 Матч идёт! Заходите в свои голосовые каналы.',
    FINISHED: '🏁 Матч завершён.',
    CANCELLED: m.endedById === null ? '🚫 Матч отменён — набор закрыт по времени.' : '🚫 Матч отменён.',
  };
  const line = statusLine[m.status];
  if (line) lines.push('', line);

  const embed = brandEmbed().setTitle(heading(m)).setDescription(lines.join('\n')).setFooter({ text: `KiberPride · матч #${m.id}` });

  if (m.status === 'IN_PROGRESS' || m.status === 'FINISHED') {
    for (const t of ['A', 'B'] as const) {
      const channel = t === 'A' ? m.voiceChannelAId : m.voiceChannelBId;
      const voice = m.status === 'IN_PROGRESS' && channel ? `\n🔊 <#${channel}>` : '';
      embed.addFields({ name: TEAM_TITLE[t], value: rosterLines(team(m, t), '—') + voice, inline: true });
    }
  } else {
    embed.addFields({
      name: `👥 Участники: ${m.participantCount}/${m.capacity}`,
      value: rosterLines(m.participants, m.status === 'RECRUITING' ? 'Пока никого — жми «🎮 Участвовать»!' : '—'),
    });
  }
  if (m.status === 'FINISHED' && m.winner) {
    embed.addFields({ name: '🏆 Итог', value: `${WINNER_TEXT[m.winner]} · ⭐ MVP: ${m.mvpUserId ? mention(m.mvpUserId) : 'не выбран'}` });
  }
  if (m.status !== 'CANCELLED') embed.addFields({ name: '💰 Награды', value: rewardsLine(m.rewards) });

  const manage = button(encodeCustomId('mpan', m.id), '⚙️ Управление', ButtonStyle.Secondary);
  const components: Row[] = [];
  if (m.status === 'RECRUITING') {
    components.push(
      row(
        button(encodeCustomId('mjoin', m.id), '🎮 Участвовать', ButtonStyle.Success),
        button(encodeCustomId('mleave', m.id), '❌ Покинуть игру', ButtonStyle.Secondary),
        manage,
      ),
    );
  } else if (m.status === 'TEAMS_PENDING') {
    components.push(row(button(encodeCustomId('mpan', m.id), '🔧 Распределить команды', ButtonStyle.Primary)));
  } else if (m.status === 'IN_PROGRESS') {
    components.push(row(button(encodeCustomId('mfin', m.id), '🏁 Завершить матч', ButtonStyle.Primary), manage));
  }
  return { embeds: [embed], components };
}

// ─── Announcements in the recruit channel (008 §8) ──────────────────────────

export interface Announcement extends View {
  /** Users this post pings; fake and departed players never. */
  pingUserIds: string[];
}

export function announcementView(m: MatchSnapshot, status: MatchStatusName): Announcement {
  const players = m.participants.filter((p) => p.leftServerAt === null && !isFakeUserId(p.userId)).map((p) => p.userId);
  switch (status) {
    // Decision 012: the words are in the embed; the message text carries ONLY the mentions,
    // because a mention inside an embed notifies nobody.
    case 'TEAMS_PENDING': {
      const ping = isFakeUserId(m.createdById) ? [] : [m.createdById];
      return {
        ...pingContent(ping),
        embeds: [
          noticeEmbed(
            `Состав матча #${m.id} (${m.game.name} ${format(m)}) собран! ${mention(m.createdById)}, распредели команды: «🔧 Распределить команды» под сообщением набора.`,
            '🔧 Пора распределить команды',
          ),
        ],
        components: [],
        pingUserIds: ping,
      };
    }
    case 'IN_PROGRESS': {
      const lines = (['A', 'B'] as const).map((t) => {
        const channel = t === 'A' ? m.voiceChannelAId : m.voiceChannelBId;
        return `${TEAM_TITLE[t]}: ${team(m, t).map(who).join(', ')}${channel ? ` → <#${channel}>` : ''}`;
      });
      return {
        ...pingContent(players),
        embeds: [noticeEmbed(lines.join('\n'), `🎮 Матч #${m.id} (${m.game.name} ${format(m)}) начался! Удачной игры 🍀`)],
        components: [],
        pingUserIds: players,
      };
    }
    case 'FINISHED':
      return { embeds: [resultCard(m)], components: [], pingUserIds: [] };
    case 'CANCELLED': {
      const why = m.endedById === null ? ' — набор закрыт по времени' : '';
      return {
        ...pingContent(players),
        embeds: [
          noticeEmbed(
            `${m.game.name} ${format(m)}${why}. KP Coin не начислялись — ждём вас в следующих играх!`,
            `🚫 Матч #${m.id} отменён`,
          ),
        ],
        components: [],
        pingUserIds: players,
      };
    }
    default:
      return { embeds: [], components: [], pingUserIds: [] };
  }
}

/** The message text of an announcement: only the mentions that must notify, or nothing. */
function pingContent(userIds: readonly string[]): { content?: string } {
  return userIds.length > 0 ? { content: userIds.map(mention).join(' ') } : {};
}

/** The FINISHED card: game, winner, rosters, MVP, paid and withheld amounts (008 §8). */
export function resultCard(m: MatchSnapshot): EmbedBuilder {
  const { paid, withheld } = payoutTotals(payoutPlan(m));
  const embed = brandEmbed()
    .setTitle(`🏁 ${heading(m)} · итог матча #${m.id}`)
    .addFields(
      { name: '🏆 Результат', value: m.winner ? WINNER_TEXT[m.winner] : '—', inline: true },
      { name: '⭐ MVP', value: m.mvpUserId ? mention(m.mvpUserId) : 'MVP не выбран', inline: true },
      { name: TEAM_TITLE.A, value: rosterLines(team(m, 'A'), '—') },
      { name: TEAM_TITLE.B, value: rosterLines(team(m, 'B'), '—') },
    );
  if (m.special) embed.setDescription('⭐ Особый матч — награды ×2');
  const lines = (totals: Map<string, number>) => [...totals].map(([u, amount]) => `${mention(u)} ${formatSignedKp(amount)}`).join('\n');
  embed.addFields({ name: '💰 Начислено', value: paid.size > 0 ? lines(paid) : 'ничего' });
  if (withheld.size > 0) embed.addFields({ name: '⏸️ Удержано — покинули сервер', value: lines(withheld) });
  return embed;
}

// ─── /игры and its settings (008 §1, §2; 009 §5) ────────────────────────────

export interface GamesPanelFlags {
  canCreate: boolean;
  canSettings: boolean;
}

export function gamesPanelView(open: MatchSnapshot[], flags: GamesPanelFlags): View {
  const embed = brandEmbed()
    .setTitle('🎮 Управление игровыми активностями')
    .setDescription(
      open.length > 0
        ? 'Создай новую игру или выбери открытый матч, чтобы управлять им.'
        : 'Открытых матчей пока нет. Создай первую игру — бот сам соберёт игроков и команды.',
    );
  const components: Row[] = [];
  const buttons: ButtonBuilder[] = [];
  if (flags.canCreate) buttons.push(button(encodeCustomId('mnew'), '➕ Создать игру', ButtonStyle.Success));
  if (flags.canSettings) buttons.push(button(encodeCustomId('mset'), '⚙️ Настройки', ButtonStyle.Secondary));
  if (buttons.length > 0) components.push(row(...buttons));
  if (open.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId('mopen'))
      .setPlaceholder('Открытые матчи — выбери, чтобы управлять')
      .addOptions(
        open.slice(0, 25).map((m) =>
          new StringSelectMenuOptionBuilder()
            .setValue(String(m.id))
            .setLabel(`#${m.id} · ${m.game.name} ${format(m)} · ${m.participantCount}/${m.capacity}`.slice(0, 100))
            .setDescription(`${STATUS_TEXT[m.status]}${m.special ? ' · ⭐ ×2' : ''} · ${m.title}`.slice(0, 100))
            .setEmoji(m.game.emoji),
        ),
      );
    components.push(row(select));
  }
  return { embeds: [embed], components };
}

export function settingsView(s: GuildSettingsView, defaults: RewardAmounts, note?: string): View {
  const timeout = s.recruitTimeoutHours === 0 ? 'никогда' : `через ${s.recruitTimeoutHours} ч`;
  const embed = brandEmbed()
    .setTitle('⚙️ Настройки игр')
    .addFields(
      { name: 'Канал для наборов', value: s.defaultRecruitChannelId ? `<#${s.defaultRecruitChannelId}>` : 'не выбран', inline: true },
      { name: 'Категория голосовых', value: s.defaultVoiceCategoryId ? `<#${s.defaultVoiceCategoryId}>` : 'не выбрана', inline: true },
      { name: 'Переносить в голосовые', value: s.autoMoveToVoice ? 'да' : 'нет', inline: true },
      { name: 'Незаполненный набор закрывается', value: timeout, inline: true },
      { name: 'Награды (по умолчанию)', value: `${rewardsLine(defaults)}\nМеняются в админ-панели — она скоро появится.` },
    );
  if (note) embed.setDescription(note);

  const recruit = new ChannelSelectMenuBuilder()
    .setCustomId(encodeCustomId('ssrc'))
    .setPlaceholder('Канал для наборов')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (s.defaultRecruitChannelId) recruit.setDefaultChannels(s.defaultRecruitChannelId);
  const category = voiceCategorySelect(s.defaultVoiceCategoryId, encodeCustomId('svc'));
  const hours = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('stmo'))
    .setPlaceholder('Когда закрывать незаполненный набор')
    .addOptions(
      RECRUIT_TIMEOUT_CHOICES.map((h) =>
        new StringSelectMenuOptionBuilder()
          .setValue(String(h))
          .setLabel(h === 0 ? 'Никогда — только вручную' : `Через ${h} ч`)
          .setDefault(h === s.recruitTimeoutHours),
      ),
    );
  const move = button(
    encodeCustomId('smove'),
    s.autoMoveToVoice ? '🔊 Переносить в голосовые: да' : '🔇 Переносить в голосовые: нет',
    s.autoMoveToVoice ? ButtonStyle.Success : ButtonStyle.Secondary,
  );
  const shop = button(encodeCustomId('sshop'), '🛒 Магазин', ButtonStyle.Primary);
  return { embeds: [embed], components: [row(recruit), row(category), row(hours), row(move, shop)] };
}

function voiceCategorySelect(current: string | null, customId: string): ChannelSelectMenuBuilder {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Категория для голосовых каналов команд')
    .setChannelTypes(ChannelType.GuildCategory);
  if (current) select.setDefaultChannels(current);
  return select;
}

/** `➕ Создать игру` before a voice category exists: pick it once, then continue (008 §3). */
export function setupCategoryView(saved: boolean): View {
  const embed = brandEmbed()
    .setTitle('Сначала — категория для голосовых')
    .setDescription(
      saved
        ? '✅ Категория сохранена. Жми «Продолжить», чтобы создать игру.'
        : 'Выбери категорию, в которой бот будет создавать голосовые каналы команд. Это нужно сделать один раз.',
    );
  return {
    embeds: [embed],
    components: [row(voiceCategorySelect(null, encodeCustomId('svc', 'n'))), row(button(encodeCustomId('mnew'), 'Продолжить', ButtonStyle.Primary, !saved))],
  };
}

export function creationModal(games: GameView[], defaultChannelId: string | null): ModalBuilder {
  const game = new StringSelectMenuBuilder()
    .setCustomId(MODAL_FIELDS.game)
    .setPlaceholder('Выбери игру')
    .addOptions(games.slice(0, 25).map((g) => new StringSelectMenuOptionBuilder().setValue(String(g.id)).setLabel(g.name).setEmoji(g.emoji)));
  const sizes = [0, ...Array.from({ length: MAX_TEAM_SIZE - MIN_TEAM_SIZE + 1 }, (_, i) => i + MIN_TEAM_SIZE)];
  const size = new StringSelectMenuBuilder()
    .setCustomId(MODAL_FIELDS.size)
    .addOptions(
      sizes.map((n) =>
        new StringSelectMenuOptionBuilder()
          .setValue(String(n))
          .setLabel(n === 0 ? 'Как обычно для игры' : `${n}×${n}`)
          .setDefault(n === 0),
      ),
    );
  const mode = new StringSelectMenuBuilder()
    .setCustomId(MODAL_FIELDS.mode)
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue('AUTO').setLabel('Случайно').setDescription('Бот сам делит игроков пополам').setDefault(true),
      new StringSelectMenuOptionBuilder().setValue('MANUAL').setLabel('Выбирает организатор').setDescription('Ты распределишь игроков сам'),
    );
  const title = new TextInputBuilder()
    .setCustomId(MODAL_FIELDS.title)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(MAX_TITLE_LENGTH)
    .setPlaceholder(DEFAULT_TITLE);
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId(MODAL_FIELDS.channel)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  if (defaultChannelId) channel.setDefaultChannels(defaultChannelId);

  return new ModalBuilder()
    .setCustomId(encodeCustomId('mnewf'))
    .setTitle('🎮 Новая игра')
    .addLabelComponents(
      new LabelBuilder().setLabel('Игра').setStringSelectMenuComponent(game),
      new LabelBuilder().setLabel('Формат').setStringSelectMenuComponent(size),
      new LabelBuilder().setLabel('Команды').setStringSelectMenuComponent(mode),
      new LabelBuilder().setLabel('Название набора').setDescription('Можно оставить пустым').setTextInputComponent(title),
      new LabelBuilder().setLabel('Где собирать игроков').setChannelSelectMenuComponent(channel),
    );
}

// ─── The organiser's match panel (008 §6, 009 §1) ───────────────────────────

export interface PanelFlags {
  /** Show «🧪 Добавить тестовых игроков» (008 §10). */
  canTest: boolean;
}

export function matchPanelView(m: MatchSnapshot, names: Names, flags: PanelFlags, note?: string): View {
  const lines = [`**${m.title}** · ${STATUS_TEXT[m.status]}`, `👥 ${m.participantCount}/${m.capacity}`];
  if (m.special) lines.push('⭐ Особый матч — награды ×2');
  lines.push(`💰 ${rewardsLine(m.rewards)}`);
  if (note) lines.unshift(note, '');
  const embed = brandEmbed().setTitle(`⚙️ ${heading(m)} · #${m.id}`).setDescription(lines.join('\n'));
  if (m.status === 'TEAMS_PENDING' || m.status === 'IN_PROGRESS') {
    for (const t of ['A', 'B'] as const) embed.addFields({ name: TEAM_TITLE[t], value: rosterLines(team(m, t), 'пока пусто'), inline: true });
    if (m.status === 'TEAMS_PENDING') {
      const unassigned = m.participants.filter((p) => p.team === null);
      if (unassigned.length > 0) embed.addFields({ name: 'Без команды', value: rosterLines(unassigned, '—') });
    }
  } else {
    embed.addFields({ name: 'Состав', value: rosterLines(m.participants, 'пока никого') });
  }

  const components: Row[] = [];
  const cancel = () => button(encodeCustomId('mcan', m.id, m.version, openStatusArg(m.status)), '🚫 Отменить матч', ButtonStyle.Danger);
  const remove = () =>
    new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId('mrm', m.id))
      .setPlaceholder('➖ Убрать игрока из состава')
      .addOptions(m.participants.map((p) => new StringSelectMenuOptionBuilder().setValue(p.userId).setLabel(nameOf(p.userId, names).slice(0, 100))));

  if (m.status === 'RECRUITING') {
    if (m.participants.length > 0) components.push(row(remove()));
    const buttons = [
      m.special
        ? button(encodeCustomId('mspc', m.id, 0), '⭐ Особый матч ×2: включён', ButtonStyle.Success)
        : button(encodeCustomId('mspc', m.id, 1), '⭐ Особый матч ×2', ButtonStyle.Secondary),
    ];
    if (flags.canTest) buttons.push(button(encodeCustomId('mtest', m.id), '🧪 Добавить тестовых игроков', ButtonStyle.Secondary));
    buttons.push(cancel());
    components.push(row(...buttons));
  } else if (m.status === 'TEAMS_PENDING') {
    const picker = new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId('mteam', m.id))
      .setPlaceholder(`🔵 Команда A — выбери ${m.teamSize} игроков, остальные будут в 🔴 B`)
      .setMinValues(m.teamSize)
      .setMaxValues(m.teamSize)
      .addOptions(
        m.participants.map((p) =>
          new StringSelectMenuOptionBuilder()
            .setValue(p.userId)
            .setLabel(nameOf(p.userId, names).slice(0, 100))
            .setDefault(p.team === 'A'),
        ),
      );
    const ready = team(m, 'A').length === m.teamSize && team(m, 'B').length === m.teamSize;
    components.push(
      row(picker),
      row(remove()),
      row(button(encodeCustomId('mtok', m.id, m.version), '✅ Подтвердить команды', ButtonStyle.Success, !ready), cancel()),
    );
  } else if (m.status === 'IN_PROGRESS') {
    components.push(row(button(encodeCustomId('mfin', m.id), '🏁 Завершить матч', ButtonStyle.Primary), cancel()));
  }
  return { embeds: [embed], components };
}

// ─── Finish flow (004 §4, 009 §3) ───────────────────────────────────────────

export function winnerView(m: MatchSnapshot): View {
  const embed = brandEmbed()
    .setTitle(`🏁 ${heading(m)} · #${m.id}`)
    .setDescription('Кто победил?')
    .addFields(
      { name: TEAM_TITLE.A, value: rosterLines(team(m, 'A'), '—'), inline: true },
      { name: TEAM_TITLE.B, value: rosterLines(team(m, 'B'), '—'), inline: true },
    );
  const pick = (w: WinnerName, label: string, style: ButtonStyle) => button(encodeCustomId('mwin', m.id, m.version, WINNER_ARG[w]), label, style);
  return {
    embeds: [embed],
    components: [row(pick('A', '🔵 Команда A', ButtonStyle.Primary), pick('B', '🔴 Команда B', ButtonStyle.Danger), pick('DRAW', '🤝 Ничья', ButtonStyle.Secondary))],
  };
}

export function mvpView(m: MatchSnapshot, winner: WinnerName, names: Names): View {
  const embed = brandEmbed().setTitle(`🏁 ${heading(m)} · #${m.id}`).setDescription(`Итог: **${WINNER_TEXT[winner]}**\n\n⭐ Выберите MVP матча`);
  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('mmvp', m.id, m.version, WINNER_ARG[winner]))
    .setPlaceholder('⭐ Выберите MVP матча')
    .addOptions(
      new StringSelectMenuOptionBuilder().setValue(NO_MVP).setLabel('Без MVP').setDescription('Награда MVP не начисляется'),
      ...m.participants
        .filter((p) => p.team !== null)
        .map((p) =>
          new StringSelectMenuOptionBuilder()
            .setValue(p.userId)
            .setLabel(nameOf(p.userId, names).slice(0, 100))
            .setEmoji(p.team === 'A' ? '🔵' : '🔴'),
        ),
    );
  return { embeds: [embed], components: [row(select)] };
}

export function finishConfirmView(m: MatchSnapshot, winner: WinnerName, mvpUserId: string | null): View {
  const preview = payoutPlan({ ...m, winner, mvpUserId });
  const total = preview.filter((l) => !l.withheld).reduce((s, l) => s + l.amount, 0);
  const withheld = preview.filter((l) => l.withheld);
  const lines = [
    `Итог: **${WINNER_TEXT[winner]}**`,
    `⭐ MVP: ${mvpUserId ? mention(mvpUserId) : 'не выбран'}`,
    '',
    `Будет начислено всего: **${formatSignedKp(total)}** (${rewardsLine(m.rewards)}).`,
  ];
  if (withheld.length > 0) lines.push('⏸️ Игроки, покинувшие сервер, награду не получат — это запишется в журнал.');
  const embed = brandEmbed().setTitle(`🏁 ${heading(m)} · #${m.id}`).setDescription(lines.join('\n'));
  return {
    embeds: [embed],
    components: [
      row(button(encodeCustomId('mcfm', m.id, m.version, WINNER_ARG[winner], mvpUserId ?? NO_MVP), '✅ Завершить и начислить', ButtonStyle.Success)),
    ],
  };
}

export function finishedView(m: MatchSnapshot): View {
  return {
    embeds: [noticeEmbed('Награды начислены. Итог опубликован в канале набора.', '✅ Матч завершён'), resultCard(m)],
    components: [],
  };
}

export function cancelConfirmView(m: MatchSnapshot): View {
  const embed = brandEmbed()
    .setTitle(`🚫 Отменить матч #${m.id}?`)
    .setDescription(`${heading(m)} · ${m.title}\nИгроки получат уведомление, KP Coin не начисляются, голосовые каналы удалятся.`);
  return { embeds: [embed], components: [row(button(encodeCustomId('mccf', m.id, m.version, openStatusArg(m.status)), '🚫 Да, отменить', ButtonStyle.Danger))] };
}

export function cancelledView(m: MatchSnapshot): View {
  return { embeds: [noticeEmbed('Игроки получат уведомление в канале набора.', `🚫 Матч #${m.id} отменён`)], components: [] };
}
