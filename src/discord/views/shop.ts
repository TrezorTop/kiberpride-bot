// Every screen of the shop and earnings (decisions 014 §10, 015): /магазин, the confirm screen,
// the clan modal and panel, the room panel, «Мои покупки», «Вся история», the shop settings and
// the private messages. Rendered only from service results; all player text lives here.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { PlayerNotice } from '../../core/ports.js';
import type { HistoryPage } from '../../modules/economy/service.js';
import type { DailyStatus } from '../../modules/earnings/service.js';
import type { ClanView } from '../../modules/shop/clan.js';
import type { Problem } from '../../modules/shop/kinds/index.js';
import { NAME_MAX, NAME_MIN } from '../../modules/shop/names.js';
import { problemText } from '../../modules/shop/problems.js';
import { MAX_GUESTS, ROOM_LIMITS, type RoomView } from '../../modules/shop/room.js';
import type { BuyResult, GoodAdminView, GrantView, Quote, ShopOverview } from '../../modules/shop/service.js';
import { encodeCustomId } from '../customId.js';
import { formatKp, formatLedgerLine, groupDigits, CURRENCY } from './format.js';
import { brandEmbed, noticeEmbed } from './style.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
export interface View {
  embeds: EmbedBuilder[];
  components: Row[];
}
export type Names = ReadonlyMap<string, string>;

export const CLAN_FIELDS = { name: 'name', color: 'color' } as const;
export const ROOM_FIELDS = { name: 'name' } as const;
const DAY_MS = 86_400_000;

const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const kp = (n: number) => `${groupDigits(n)} ${CURRENCY}`;

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

function button(customId: string, label: string, style: ButtonStyle, disabled = false): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
}

function nameOf(userId: string, names: Names): string {
  return names.get(userId) ?? `Игрок …${userId.slice(-4)}`;
}

/** «✅ до 20 окт.», «⏳ выдаётся», «⏳ заканчивается через 5 часов» (014 §10, 015 §1). */
export function grantStateText(g: Pick<GrantView, 'applied' | 'expiresAt'>, now: Date): string {
  if (!g.applied) return '⏳ выдаётся';
  if (!g.expiresAt) return '✅ навсегда';
  if (g.expiresAt.getTime() - now.getTime() <= DAY_MS) return `⏳ заканчивается <t:${unix(g.expiresAt)}:R>`;
  return `✅ до <t:${unix(g.expiresAt)}:D>`;
}

const validity = (days: number | null) => (days === null ? 'навсегда' : `${days} дней`);

// ─── /магазин (014 §10) ─────────────────────────────────────────────────────

export function shopView(o: ShopOverview, now: Date, note?: string): View {
  const embed = brandEmbed().setTitle('🛒 Магазин KiberPride').setDescription([note, `Твой баланс: **${formatKp(o.balance)}**`].filter(Boolean).join('\n\n'));
  if (o.goods.length === 0) embed.addFields({ name: 'Скоро', value: 'Магазин ещё настраивается — загляни чуть позже 🙂' });
  for (const g of o.goods) {
    const state = g.grant ? `\n${grantStateText(g.grant, now)}` : '';
    embed.addFields({ name: `${g.name} — ${kp(g.price)} · ${validity(g.validityDays)}`, value: `${g.line}${state}` });
  }
  const components: Row[] = [];
  if (o.goods.length > 0) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeCustomId('shsel'))
          .setPlaceholder('Выбери товар, чтобы купить или продлить')
          .addOptions(
            o.goods.slice(0, 25).map((g) =>
              new StringSelectMenuOptionBuilder()
                .setValue(String(g.id))
                .setLabel(g.name.slice(0, 100))
                .setDescription(`${g.grant ? 'Продлить · ' : ''}${kp(g.price)} · ${validity(g.validityDays)}`.slice(0, 100)),
            ),
          ),
      ),
    );
  }
  const manage: ButtonBuilder[] = [];
  if (o.inClan) manage.push(button(encodeCustomId('clan'), '🛡️ Мой клан', ButtonStyle.Secondary));
  if (o.hasRoom) manage.push(button(encodeCustomId('room'), '🏠 Моя комната', ButtonStyle.Secondary));
  if (manage.length > 0) components.push(row(...manage));
  return { embeds: [embed], components };
}

export function quoteView(q: Quote): View {
  const lines: string[] = [q.good.line, ''];
  const until = q.expiresAt ? `<t:${unix(q.expiresAt)}:D>` : 'навсегда';
  let action: ButtonBuilder | null = null;
  switch (q.mode) {
    case 'pending':
      lines.push('⏳ Этот товар уже оплачен и сейчас выдаётся. Продлить можно, когда он появится.');
      break;
    case 'owned':
      lines.push('✅ Это у тебя уже есть навсегда.');
      break;
    case 'renew':
      lines.push(
        `Продлить на ${validity(q.good.validityDays)} за **${kp(q.price)}**.`,
        `Сейчас действует до <t:${unix(q.current?.expiresAt ?? new Date())}:D>, после продления — до ${until}.`,
      );
      action = button(encodeCustomId('shbuy', q.good.id, q.expectedPeriods), '🔁 Продлить', ButtonStyle.Success, q.shortBy > 0);
      break;
    case 'new':
      lines.push(`Цена: **${kp(q.price)}** · действует до ${until}.`);
      action = q.clanForm
        ? button(encodeCustomId('shcnew', q.good.id), '✏️ Придумать название и цвет', ButtonStyle.Success, q.shortBy > 0)
        : button(encodeCustomId('shbuy', q.good.id, 0), '✅ Купить', ButtonStyle.Success, q.shortBy > 0);
      break;
  }
  if (action) {
    lines.push(
      '',
      q.shortBy > 0
        ? `Твой баланс: ${formatKp(q.balance)} — не хватает **${kp(q.shortBy)}**. Их можно заработать в матчах, бонусом /бонус и временем в голосовых 🎮`
        : `Баланс после покупки: ${formatKp(q.balance - q.price)}`,
    );
  }
  const embed = brandEmbed().setTitle(`🛒 ${q.good.name}`).setDescription(lines.join('\n'));
  return { embeds: [embed], components: action ? [row(action)] : [] };
}

export function buyResultView(r: BuyResult): View {
  const until = r.expiresAt ? ` до <t:${unix(r.expiresAt)}:D>` : ' навсегда';
  const head = r.renewed ? `🔁 «${r.goodName}» продлено${until}!` : `🎉 «${r.goodName}» теперь твоё${until}!`;
  const status = r.applied ? '' : '\n\n✅ Оплачено! Доступ появится в течение пары минут.';
  const hint = r.kind === 'clan_role' && !r.renewed ? '\n\nДобавь друзей в клан: «🛡️ Мой клан».' : r.kind === 'personal_room' && !r.renewed ? '\n\nНастрой комнату: «🏠 Моя комната».' : '';
  const embed = noticeEmbed(`${head}${status}${hint}\n\nБаланс: ${formatKp(r.balanceAfter)}`, '✅ Покупка');
  const components: Row[] = [];
  if (r.kind === 'clan_role') components.push(row(button(encodeCustomId('clan'), '🛡️ Мой клан', ButtonStyle.Primary)));
  if (r.kind === 'personal_room') components.push(row(button(encodeCustomId('room'), '🏠 Моя комната', ButtonStyle.Primary)));
  return { embeds: [embed], components };
}

// ─── Clan (014 §3.2, 015 §3) ────────────────────────────────────────────────

/** The name-and-colour form: a new clan (`shclan:<goodId>`) or a rename (`clrenf`). */
export function clanModal(palette: ClanView['palette'], target: { goodId: number } | { rename: true }, current?: { name: string; color: number }): ModalBuilder {
  const name = new TextInputBuilder()
    .setCustomId(CLAN_FIELDS.name)
    .setStyle(TextInputStyle.Short)
    .setMinLength(NAME_MIN)
    .setMaxLength(NAME_MAX)
    .setRequired(true)
    .setPlaceholder('Например: Ночные волки');
  if (current) name.setValue(current.name);
  const color = new StringSelectMenuBuilder()
    .setCustomId(CLAN_FIELDS.color)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      palette.slice(0, 25).map((p, i) => {
        const option = new StringSelectMenuOptionBuilder().setValue(String(i)).setLabel(p.label).setDefault(current?.color === p.rgb);
        return p.emoji ? option.setEmoji(p.emoji) : option;
      }),
    );
  return new ModalBuilder()
    .setCustomId('goodId' in target ? encodeCustomId('shclan', target.goodId) : encodeCustomId('clrenf'))
    .setTitle('goodId' in target ? '🛡️ Новый клан' : '✏️ Название и цвет клана')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Название клана')
        .setDescription(`${NAME_MIN}–${NAME_MAX} символа: буквы, цифры, эмодзи, пробел и - _ . ! ?`)
        .setTextInputComponent(name),
      new LabelBuilder().setLabel('Цвет роли').setStringSelectMenuComponent(color),
    );
}

export function clanPanelView(c: ClanView, names: Names, now: Date, note?: string): View {
  const colour = c.colorLabel ?? `#${c.color.toString(16).padStart(6, '0')}`;
  const members = c.memberIds.length > 0 ? c.memberIds.map((id) => `<@${id}>`).join('\n') : c.isOwner ? 'Пока никого — добавь друзей ниже 👇' : '—';
  const expiry = c.expiresAt ? grantStateText({ applied: c.applied, expiresAt: c.expiresAt }, now) : '✅ навсегда';
  const embed = brandEmbed()
    .setTitle(`🛡️ Клан «${c.name}»`)
    .setDescription(note ?? null)
    .addFields(
      { name: 'Владелец', value: `<@${c.ownerId}>`, inline: true },
      { name: 'Цвет', value: colour, inline: true },
      { name: 'Срок', value: expiry, inline: true },
      { name: `Участники: ${c.memberIds.length}/${c.maxMembers}`, value: members },
    );
  const components: Row[] = [];
  if (c.isOwner) {
    const free = c.maxMembers - c.memberIds.length;
    if (free > 0) {
      components.push(
        row(
          new UserSelectMenuBuilder()
            .setCustomId(encodeCustomId('cladd'))
            .setPlaceholder(`➕ Добавить в клан (свободно мест: ${free})`)
            .setMinValues(1)
            .setMaxValues(Math.min(free, 25)),
        ),
      );
    }
    if (c.memberIds.length > 0) {
      components.push(
        row(
          new StringSelectMenuBuilder()
            .setCustomId(encodeCustomId('clrm'))
            .setPlaceholder('➖ Убрать из клана')
            .addOptions(c.memberIds.slice(0, 25).map((id) => new StringSelectMenuOptionBuilder().setValue(id).setLabel(nameOf(id, names).slice(0, 100)))),
        ),
      );
    }
    components.push(row(button(encodeCustomId('clren'), '✏️ Название и цвет', ButtonStyle.Secondary)));
  } else {
    components.push(row(button(encodeCustomId('clleave'), '🚪 Выйти из клана', ButtonStyle.Danger)));
  }
  return { embeds: [embed], components };
}

// ─── Personal room (014 §3.3) ───────────────────────────────────────────────

export function roomNameModal(current: string): ModalBuilder {
  const name = new TextInputBuilder()
    .setCustomId(ROOM_FIELDS.name)
    .setStyle(TextInputStyle.Short)
    .setMinLength(NAME_MIN)
    .setMaxLength(NAME_MAX)
    .setRequired(true)
    .setValue(current);
  return new ModalBuilder()
    .setCustomId(encodeCustomId('rmnamef'))
    .setTitle('✏️ Название комнаты')
    .addLabelComponents(new LabelBuilder().setLabel('Название').setDescription('Буквы, цифры, эмодзи, пробел и - _ . ! ?').setTextInputComponent(name));
}

export function roomPanelView(r: RoomView, names: Names, now: Date, note?: string): View {
  const guests = r.guestIds.length > 0 ? r.guestIds.map((id) => `<@${id}>`).join('\n') : 'Пока никого';
  const embed = brandEmbed()
    .setTitle(`🏠 ${r.name}`)
    .setDescription([note, r.channelId ? `Канал: <#${r.channelId}>` : '⏳ Комната создаётся — загляни через минуту.'].filter(Boolean).join('\n\n'))
    .addFields(
      { name: 'Вход', value: r.locked ? '🔒 только ты и гости' : '🔓 открыт для всех', inline: true },
      { name: 'Мест', value: r.userLimit === 0 ? 'без ограничения' : String(r.userLimit), inline: true },
      { name: 'Срок', value: r.expiresAt ? grantStateText({ applied: r.applied, expiresAt: r.expiresAt }, now) : '✅ навсегда', inline: true },
      { name: `Гости: ${r.guestIds.length}/${MAX_GUESTS}`, value: guests },
    );
  const limit = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('rmlim'))
    .setPlaceholder('👥 Сколько мест в комнате')
    .addOptions(
      ROOM_LIMITS.map((n) =>
        new StringSelectMenuOptionBuilder()
          .setValue(String(n))
          .setLabel(n === 0 ? 'Без ограничения' : `${n} мест`)
          .setDefault(n === r.userLimit),
      ),
    );
  const components: Row[] = [
    row(
      button(encodeCustomId('rmname'), '✏️ Название', ButtonStyle.Secondary),
      r.locked
        ? button(encodeCustomId('rmlock', 0), '🔓 Открыть для всех', ButtonStyle.Secondary)
        : button(encodeCustomId('rmlock', 1), '🔒 Закрыть', ButtonStyle.Secondary),
    ),
    row(limit),
  ];
  if (r.guestIds.length < MAX_GUESTS) {
    components.push(
      row(
        new UserSelectMenuBuilder()
          .setCustomId(encodeCustomId('rmadd'))
          .setPlaceholder('➕ Пустить в комнату')
          .setMinValues(1)
          .setMaxValues(Math.min(MAX_GUESTS - r.guestIds.length, 25)),
      ),
    );
  }
  if (r.guestIds.length > 0) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeCustomId('rmrm'))
          .setPlaceholder('➖ Убрать гостя')
          .addOptions(r.guestIds.slice(0, 25).map((id) => new StringSelectMenuOptionBuilder().setValue(id).setLabel(nameOf(id, names).slice(0, 100)))),
      ),
    );
  }
  return { embeds: [embed], components };
}

/** «Добавил: …» / «Не получилось: …» after a clan add or a room invite. */
export function addOutcomeNote(added: readonly string[], refused: readonly { userId: string; code: string }[], names: Names): string {
  const why: Record<string, string> = {
    INVALID_TARGET: 'нельзя',
    IN_OTHER_CLAN: 'уже в другом клане',
    ALREADY_JOINED: 'уже здесь',
    CLAN_FULL: 'мест нет',
    ROOM_FULL: 'мест нет',
    NO_CLAN: 'клан закрыт',
  };
  const parts: string[] = [];
  if (added.length > 0) parts.push(`✅ Добавлены: ${added.map((id) => `<@${id}>`).join(', ')}`);
  if (refused.length > 0) parts.push(`⚠️ Не добавлены: ${refused.map((r) => `${nameOf(r.userId, names)} — ${why[r.code] ?? 'не вышло'}`).join('; ')}`);
  return parts.join('\n');
}

// ─── «Мои покупки», «Вся история», daily bonus ──────────────────────────────

export function purchasesView(grants: readonly GrantView[], now: Date, flags: { dev: boolean }, note?: string): View {
  const lines = grants.map((g) => `**${g.goodName}** — ${grantStateText(g, now)}`);
  const embed = brandEmbed()
    .setTitle('🛍️ Мои покупки')
    .setDescription([note, lines.length > 0 ? lines.join('\n') : 'Пока ничего — загляни в /магазин 🛒'].filter(Boolean).join('\n\n'));
  const components: Row[] = [];
  if (flags.dev) {
    const soon = grants.filter((g) => g.applied && g.expiresAt).slice(0, 5);
    if (soon.length > 0) {
      components.push(row(...soon.map((g) => button(encodeCustomId('dexp', g.purchaseId), `🧪 ${g.goodName}: закончить через 2 минуты`.slice(0, 80), ButtonStyle.Secondary))));
    }
  }
  return { embeds: [embed], components };
}

export function historyView(userId: string, p: HistoryPage, own: boolean): View {
  const lines = p.entries.map((e) => `${formatLedgerLine(e)} · <t:${unix(e.createdAt)}:d>`);
  const embed = brandEmbed()
    .setTitle(own ? '📜 Вся история' : '📜 История игрока')
    .setDescription(
      [own ? null : `<@${userId}>`, lines.length > 0 ? lines.join('\n') : 'Пока пусто — сыграй матч, чтобы заработать первые KP Coin 🎮'].filter(Boolean).join('\n\n'),
    )
    .setFooter({ text: `KiberPride · страница ${p.page} из ${p.pages}` });
  if (p.pages <= 1) return { embeds: [embed], components: [] };
  return {
    embeds: [embed],
    components: [
      row(
        button(encodeCustomId('hpg', userId, Math.max(1, p.page - 1)), '◀️ Новее', ButtonStyle.Secondary, p.page <= 1),
        button(encodeCustomId('hpg', userId, Math.min(p.pages, p.page + 1)), 'Старее ▶️', ButtonStyle.Secondary, p.page >= p.pages),
      ),
    ],
  };
}

export function dailyClaimedEmbed(amount: number, balanceAfter: number, nextAt: Date): EmbedBuilder {
  return noticeEmbed(`+${kp(amount)} — ежедневный бонус! 🎁\nБаланс: ${formatKp(balanceAfter)}\n\nСледующий — <t:${unix(nextAt)}:R>.`, '🎁 Ежедневный бонус');
}

export function dailyStatusLine(s: DailyStatus): string {
  if (s.amount <= 0) return '';
  return s.claimed ? `🎁 Бонус получен — следующий <t:${unix(s.nextAt)}:R>` : `🎁 Бонус ${kp(s.amount)} ждёт — жми кнопку!`;
}

// ─── Private messages (014 §4, 015 §1) ──────────────────────────────────────

export function playerNoticeEmbed(n: PlayerNotice): EmbedBuilder {
  switch (n.kind) {
    case 'grant_expiring':
      return noticeEmbed(
        `«${n.goodName}» заканчивается <t:${unix(n.expiresAt)}:R>.\nПродлить можно в /магазин на сервере KiberPride — срок прибавится к оставшемуся 🙂`,
        '⏳ Скоро закончится покупка',
      );
    case 'grant_refunded':
      return noticeEmbed(
        `Не получилось выдать «${n.goodName}» — прости! ${kp(n.amount)} вернулись на твой баланс. Администраторы уже разбираются.`,
        '↩️ KP Coin возвращены',
      );
  }
}

// ─── Shop settings: /настройки-магазина (014 §7, 015, 016) ──────────────────

export function shopSettingsView(goods: readonly GoodAdminView[], selectedId: number | null, note?: string): View {
  const embed = brandEmbed()
    .setTitle('🛒 Настройки магазина')
    .setDescription(
      [
        note,
        'Выбирая канал, ты разрешаешь боту настроить в нём права: всем — запрет картинок и GIF, покупателям — разрешение. Убранный из списка канал возвращается к обычным правам.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  for (const v of goods) {
    const g = v.good;
    const status = g.enabled ? '✅ включён' : '⛔ выключен';
    const lines = [`${status} · ${kp(g.price)} · ${validity(g.validityDays)} · цены меняются в админ-панели`];
    const config = (g.config ?? {}) as Record<string, unknown>;
    if (g.kind === 'channel_permission') {
      const ids = Array.isArray(config.channelIds) ? (config.channelIds as string[]) : [];
      lines.push(`Каналы: ${ids.length > 0 ? ids.map((id) => `<#${id}>`).join(', ') : 'не выбраны'}`);
    }
    if (g.kind === 'personal_room') lines.push(`Категория комнат: ${typeof config.categoryId === 'string' ? `<#${config.categoryId}>` : 'не выбрана'}`);
    if (g.kind === 'clan_role') lines.push(`Клановые роли ставятся под: ${typeof config.anchorRoleId === 'string' ? `<@&${config.anchorRoleId}>` : 'роль не выбрана'}`);
    for (const p of v.problems) lines.push(`⚠️ ${problemText(p)}`);
    for (const w of v.warnings) lines.push(`ℹ️ ${problemText(w)}`);
    embed.addFields({ name: g.name, value: lines.join('\n').slice(0, 1024) });
  }

  const components: Row[] = [];
  const media = goods.find((v) => v.good.kind === 'channel_permission');
  if (media) {
    const ids = ((media.good.config as Record<string, unknown>).channelIds as string[] | undefined) ?? [];
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(encodeCustomId('shch', media.good.id))
      .setPlaceholder(`Каналы для «${media.good.name}»`.slice(0, 150))
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(25);
    if (ids.length > 0) select.setDefaultChannels(ids.slice(0, 25));
    components.push(row(select));
  }
  const room = goods.find((v) => v.good.kind === 'personal_room');
  if (room) {
    const current = (room.good.config as Record<string, unknown>).categoryId;
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(encodeCustomId('shcat', room.good.id))
      .setPlaceholder('Категория для личных комнат')
      .setChannelTypes(ChannelType.GuildCategory);
    if (typeof current === 'string') select.setDefaultChannels(current);
    components.push(row(select));
  }
  const clan = goods.find((v) => v.good.kind === 'clan_role');
  if (clan) {
    const current = (clan.good.config as Record<string, unknown>).anchorRoleId;
    const select = new RoleSelectMenuBuilder().setCustomId(encodeCustomId('shanc', clan.good.id)).setPlaceholder('Роль, под которой ставить клановые роли');
    if (typeof current === 'string') select.setDefaultRoles(current);
    components.push(row(select));
  }
  if (goods.length > 0) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(encodeCustomId('shgs'))
          .setPlaceholder('Выбери товар, чтобы включить или выключить')
          .addOptions(
            goods.slice(0, 25).map((v) =>
              new StringSelectMenuOptionBuilder()
                .setValue(String(v.good.id))
                .setLabel(v.good.name.slice(0, 100))
                .setDescription(v.good.enabled ? 'включён' : 'выключен')
                .setDefault(v.good.id === selectedId),
            ),
          ),
      ),
    );
  }
  // A screen of its own, opened by /настройки-магазина (decision 016): no way back to /игры.
  const selected = goods.find((v) => v.good.id === selectedId);
  if (selected) {
    components.push(
      row(
        selected.good.enabled
          ? button(encodeCustomId('shen', selected.good.id, 0), `⛔ Выключить «${selected.good.name}»`.slice(0, 80), ButtonStyle.Danger)
          : button(encodeCustomId('shen', selected.good.id, 1), `✅ Включить «${selected.good.name}»`.slice(0, 80), ButtonStyle.Success),
      ),
    );
  }
  return { embeds: [embed], components: components.slice(0, 5) };
}

/** The problems that kept a good switched off, as one note for the settings screen. */
export function enableRefusedNote(name: string, problems: readonly Problem[]): string {
  return `⛔ «${name}» пока нельзя включить:\n${problems.map((p) => `• ${problemText(p)}`).join('\n')}`;
}
