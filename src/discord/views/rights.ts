// The `/права` screen: which roles hold which right, and the two selects that change it. All
// player-facing text lives here (rule plain-language §8); the right itself is checked by the
// permissions service, never by this view.
import {
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { CAPABILITIES, MAX_ROLES_PER_CAPABILITY, type CapabilityName, type RightsMap } from '../../modules/permissions/service.js';
import { encodeCustomId } from '../customId.js';
import { brandEmbed } from './style.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
export interface View {
  embeds: EmbedBuilder[];
  components: Row[];
}

/** One plain-Russian line per right; `label` is what a menu shows, `line` what the right means. */
export const CAPABILITY_TEXT: Record<CapabilityName, { emoji: string; label: string; line: string }> = {
  ACTIVITY_CREATE: { emoji: '🎮', label: 'Создавать игры', line: 'создавать наборы на игры' },
  MATCH_MANAGE_ANY: { emoji: '🛠️', label: 'Управлять чужими матчами', line: 'управлять любым матчем, а не только своим' },
  ECONOMY_ADMIN: { emoji: '💰', label: 'Управлять KP Coin', line: 'смотреть чужую историю и начислять KP Coin вручную' },
  // Since 023 this right also ends a player's purchase and decides whether the coins come back.
  SHOP_MANAGE: { emoji: '🛒', label: 'Управлять магазином', line: 'управлять товарами магазина и отзывать покупки игроков' },
  // Self-amplifying: its holder can grant every other right, including KP Coin. Say so (020).
  SETTINGS_MANAGE: { emoji: '⚙️', label: 'Менять настройки', line: 'менять настройки бота и раздавать права — в том числе на начисление KP Coin' },
};

export const NOT_SET = 'не задано';

const mentions = (roleIds: readonly string[]) => (roleIds.length > 0 ? roleIds.map((id) => `<@&${id}>`).join(', ') : NOT_SET);

function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

export function rightsView(rights: RightsMap, selected: CapabilityName | null, note?: string): View {
  const embed = brandEmbed()
    .setTitle('🛡️ Права на сервере')
    .setDescription(
      [
        note,
        'Выбери право внизу, потом отметь роли, у которых оно будет. Владелец сервера и администраторы могут всё и так.',
        'Чтобы роль видела команду `/игры` в списке, включи её для этой роли: Настройки сервера → Интеграции → KiberPride Bot. Права ниже работают в любом случае.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  for (const capability of CAPABILITIES) {
    const text = CAPABILITY_TEXT[capability];
    embed.addFields({ name: `${text.emoji} ${text.label} — ${text.line}`.slice(0, 256), value: mentions(rights[capability]).slice(0, 1024) });
  }

  const picker = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId('rcap'))
    .setPlaceholder('Выбери право, чтобы раздать его ролям')
    .addOptions(
      CAPABILITIES.map((capability) =>
        new StringSelectMenuOptionBuilder()
          .setValue(capability)
          .setEmoji(CAPABILITY_TEXT[capability].emoji)
          .setLabel(CAPABILITY_TEXT[capability].label.slice(0, 100))
          .setDescription(CAPABILITY_TEXT[capability].line.slice(0, 100))
          .setDefault(capability === selected),
      ),
    );
  const components: Row[] = [row(picker)];

  if (selected) {
    const current = rights[selected];
    const roles = new RoleSelectMenuBuilder()
      .setCustomId(encodeCustomId('rrol', selected))
      .setPlaceholder(`Кто может ${CAPABILITY_TEXT[selected].line}`.slice(0, 150))
      .setMinValues(0)
      .setMaxValues(MAX_ROLES_PER_CAPABILITY);
    if (current.length > 0) roles.setDefaultRoles(current.slice(0, MAX_ROLES_PER_CAPABILITY));
    components.push(row(roles));
  }
  return { embeds: [embed], components };
}

/** The log-channel line for one save (rule bot-always-on §3): who gave or took what, from whom. */
export function rightsLogLine(actorId: string, capability: CapabilityName, change: { added: string[]; removed: string[] }): string {
  const what = `«${CAPABILITY_TEXT[capability].line}»`;
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(`дал право ${what} ролям ${change.added.map((id) => `<@&${id}>`).join(', ')}`);
  if (change.removed.length > 0) parts.push(`забрал право ${what} у ролей ${change.removed.map((id) => `<@&${id}>`).join(', ')}`);
  return `⚙️ <@${actorId}> ${parts.join('; ')}.`;
}
