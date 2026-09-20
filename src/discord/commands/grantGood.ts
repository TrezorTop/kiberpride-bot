// /выдать-товар — an administrator hands a good to a player, without KP Coin moving (decision
// 024 §1). `default_member_permissions = 0` keeps it out of every list but an Administrator's
// (decision 020 §2); the right that counts is SHOP_MANAGE, checked in the shop service on every
// call and here once more before the clan form opens.
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { DomainError } from '../../core/errors.js';
import { Capability } from '../../modules/permissions/service.js';
import { GRANT_DAYS_DEFAULT, GRANT_DAYS_MAX, GRANT_DAYS_MIN } from '../../modules/shop/service.js';
import { actorOf } from '../member.js';
import type { CommandRoute } from '../router.js';
import { grantClanPromptView, grantGoodResultView } from '../views/shop.js';

/** Option names, in one place: the handler reads exactly what the definition declares. */
export const GRANT_GOOD_OPTIONS = { user: 'игрок', good: 'товар', days: 'дней' } as const;

/**
 * The goods a hand-out may name, as Discord's own choice list. They are static because Discord is
 * given the command's options once, at registration (src/discord/client.ts), while the goods live
 * in the database — a list built from it would freeze whatever was enabled at that second and
 * would lie after the next «✅ Включить». The catalogue itself is fixed in code (`prisma/seed.ts`),
 * and the choice carries the SLUG, which survives a re-seed into a fresh database where a row id
 * would not. Everything the administrator and the player then see is the good's name from the
 * database, never this label.
 */
export const GRANT_GOOD_CHOICES = [
  { name: 'Доступ к картинкам и GIF', value: 'media_access' },
  { name: 'Клановая роль', value: 'clan_role' },
  { name: 'Личная комната', value: 'personal_room' },
] as const;

export const grantGoodCommand: CommandRoute = {
  definition: new SlashCommandBuilder()
    .setName('выдать-товар')
    .setDescription('Выдать игроку товар из магазина без списания KP Coin')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(0n)
    .addUserOption((o) => o.setName(GRANT_GOOD_OPTIONS.user).setDescription('Кому').setRequired(true))
    .addStringOption((o) =>
      o
        .setName(GRANT_GOOD_OPTIONS.good)
        .setDescription('Что выдать')
        .setRequired(true)
        .addChoices(...GRANT_GOOD_CHOICES.map((c) => ({ name: c.name, value: c.value }))),
    )
    .addIntegerOption((o) =>
      o
        .setName(GRANT_GOOD_OPTIONS.days)
        .setDescription(`На сколько дней (по умолчанию ${GRANT_DAYS_DEFAULT})`)
        .setMinValue(GRANT_DAYS_MIN)
        .setMaxValue(GRANT_DAYS_MAX),
    )
    .toJSON(),

  async run(interaction, ctx) {
    const actor = await actorOf(interaction);
    if (!(await ctx.permissions.can(actor, Capability.SHOP_MANAGE))) throw new DomainError('NOT_ALLOWED', 'grant good');
    const target = interaction.options.getUser(GRANT_GOOD_OPTIONS.user, true);
    if (target.bot) throw new DomainError('TARGET_IS_BOT', target.id);
    const slug = interaction.options.getString(GRANT_GOOD_OPTIONS.good, true);
    const days = interaction.options.getInteger(GRANT_GOOD_OPTIONS.days) ?? GRANT_DAYS_DEFAULT;

    const good = await ctx.shop.goodBySlug(slug);
    if (!good) throw new DomainError('NOT_FOUND', `good ${slug}`);

    // A clan cannot start without a name and a colour (024 §1), and a slash command is already
    // deferred, so the form is one button away — exactly as buying a clan works (014 §10).
    if (good.kind === 'clan_role' && !(await ctx.shop.grants(target.id)).some((g) => g.goodId === good.id)) {
      await interaction.editReply(grantClanPromptView({ goodId: good.id, goodName: good.name, userId: target.id, days }));
      return;
    }

    const member = interaction.inCachedGuild() ? interaction.options.getMember(GRANT_GOOD_OPTIONS.user) : null;
    const result = await ctx.shop.grantByAdmin(actor, {
      userId: target.id,
      goodId: good.id,
      days,
      roomName: `🏠 ${member?.displayName ?? target.displayName}`,
      targetIsBot: target.bot,
    });
    await interaction.editReply(grantGoodResultView(result));
  },
};
