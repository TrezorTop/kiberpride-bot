// What the services need to know about the person pressing (MemberFacts, no discord.js types)
// and the display names a select menu needs (a select cannot render a mention).
import { PermissionFlagsBits, type Guild, type GuildMember, type Interaction } from 'discord.js';
import { isFakeUserId } from '../core/match.js';
import type { MemberFacts } from '../modules/permissions/service.js';

async function memberOf(interaction: Interaction): Promise<{ guild: Guild; member: GuildMember }> {
  const guild = interaction.guild ?? (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId) : null);
  if (!guild) throw new Error('interaction outside a guild');
  const member = interaction.inCachedGuild() ? interaction.member : await guild.members.fetch(interaction.user.id);
  return { guild, member };
}

export async function actorOf(interaction: Interaction): Promise<MemberFacts> {
  const { guild, member } = await memberOf(interaction);
  return {
    userId: interaction.user.id,
    roleIds: [...member.roles.cache.keys()],
    isGuildOwner: guild.ownerId === interaction.user.id,
    isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator),
  };
}

/** Display names of real members; a missing one falls back in the view. Never throws. */
export async function displayNames(interaction: Interaction, userIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const real = [...new Set(userIds)].filter((id) => !isFakeUserId(id));
  if (real.length === 0) return names;
  try {
    const { guild } = await memberOf(interaction);
    const members = await guild.members.fetch({ user: real });
    for (const [id, m] of members) names.set(id, m.displayName);
  } catch {
    // a name is cosmetic: the view shows «Игрок …1234» instead
  }
  return names;
}
