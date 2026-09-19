// `clan_role` (decisions 014 §3.2, 015 §3–§4): one role per clan, holding nothing on the server,
// named and coloured by the buyer from a palette, placed directly below the anchor role the
// admin picked. Convergence makes the role's members equal {owner} ∪ the present members; the
// name and colour are written only at creation and on the owner's rename, so a moderator's rename
// in Discord is never reverted.
import { z } from 'zod';
import { isFakeUserId } from '../../../core/match.js';
import type { ShopGateway } from '../../../core/ports.js';
import { defineKind, snowflake, type Problem } from './types.js';

/** Discord refuses a 251st role; the clan leaves room for the server's own. */
export const GUILD_ROLE_LIMIT = 250;

export const clanRoleConfig = z.object({
  maxMembers: z.number().int().min(1).max(25),
  forbiddenWords: z.array(z.string().max(40)).max(200),
  palette: z
    .array(z.object({ label: z.string().min(1).max(40), emoji: z.string().max(16).optional(), rgb: z.number().int().min(0).max(0xffffff) }))
    .min(1)
    .max(25),
  /** The clan role goes directly below it (015 §4); without it the good cannot be enabled. */
  anchorRoleId: snowflake.nullable(),
});
export type ClanRoleConfig = z.infer<typeof clanRoleConfig>;

/** Readable on both Discord themes; no white, black or near-brand staff colours. */
export const DEFAULT_CLAN_PALETTE: ClanRoleConfig['palette'] = [
  { label: 'Красный', emoji: '🔴', rgb: 0xe74c3c },
  { label: 'Оранжевый', emoji: '🟠', rgb: 0xe67e22 },
  { label: 'Золотой', emoji: '🟡', rgb: 0xf1c40f },
  { label: 'Зелёный', emoji: '🟢', rgb: 0x2ecc71 },
  { label: 'Мятный', emoji: '🌿', rgb: 0x1abc9c },
  { label: 'Голубой', emoji: '🩵', rgb: 0x5dade2 },
  { label: 'Синий', emoji: '🔵', rgb: 0x4a6cf7 },
  { label: 'Фиолетовый', emoji: '🟣', rgb: 0x9b59b6 },
  { label: 'Розовый', emoji: '🌸', rgb: 0xff6fae },
  { label: 'Малиновый', emoji: '🍒', rgb: 0xc2185b },
  { label: 'Коричневый', emoji: '🟤', rgb: 0xb9770e },
  { label: 'Серебристый', emoji: '⚪', rgb: 0x95a5a6 },
];

/** Names a clan may not contain: they would pass for staff or the server itself (014 §3.2). */
export const DEFAULT_FORBIDDEN_WORDS = ['админ', 'модер', 'организатор', 'kiberpride', 'кибер', 'admin', 'mod', 'staff', 'owner', 'бот'];

async function serverProblems(config: ClanRoleConfig, gateway: ShopGateway): Promise<Problem[]> {
  if (!(await gateway.roleManageable(null)).botCanManageRoles) return [{ code: 'no_manage_roles' }];
  const problems: Problem[] = [];
  if (!config.anchorRoleId) problems.push({ code: 'anchor_missing' });
  else {
    const anchor = await gateway.roleManageable(config.anchorRoleId);
    if (!anchor.exists) problems.push({ code: 'anchor_gone' });
    else if (!anchor.belowBot) problems.push({ code: 'anchor_above_bot' });
  }
  if ((await gateway.guildRoleNames()).length >= GUILD_ROLE_LIMIT) problems.push({ code: 'too_many_roles' });
  return problems;
}

export const clanRoleKind = defineKind<ClanRoleConfig>({
  configSchema: clanRoleConfig,
  settable: ['anchorRoleId'],
  sharedResource: false,

  async validate(good, env) {
    return { problems: await serverProblems(good.config, env.gateway), warnings: [] };
  },

  precheck: (good, env) => serverProblems(good.config, env.gateway),

  async apply(grant, good, env) {
    const clan = grant.clan;
    if (!clan) throw new Error(`purchase ${grant.purchaseId}: a clan_role grant without a clan row`);
    const roleId = await env.gateway.ensureRole({
      currentId: clan.roleId,
      name: clan.name,
      color: clan.color,
      restyle: false,
      adoptByName: false,
      belowRoleId: good.config.anchorRoleId,
      reason: `KiberPride Bot: clan role #${clan.id} (decision 014 §3.2)`,
    });
    if (roleId !== clan.roleId) await env.saveClanRole(clan.id, roleId);

    const wanted = new Set([clan.ownerId, ...clan.memberIds].filter((id) => !isFakeUserId(id)));
    const holding = new Set(await env.gateway.roleMembers(roleId));
    for (const id of wanted) if (!holding.has(id)) await env.gateway.setMemberRole(id, roleId, true);
    for (const id of holding) if (!wanted.has(id)) await env.gateway.setMemberRole(id, roleId, false);
    return 'applied';
  },

  async revoke(grant, _good, env) {
    if (grant.clan?.roleId) await env.gateway.deleteRole(grant.clan.roleId);
  },

  describe(good) {
    return `Своя роль с названием и цветом, до ${good.config.maxMembers} участников`;
  },
});
