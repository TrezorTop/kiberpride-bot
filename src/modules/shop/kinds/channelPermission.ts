// `channel_permission` (decisions 014 §3.1, 015 §2): a bot-created role that holds nothing on
// the server, and per chosen channel an @everyone deny plus a role allow of the granted
// permissions, written with `permissionOverwrites.edit` per target — never `set`, which would
// wipe the server's own overwrites. The role is shared by every buyer of the good.
import { z } from 'zod';
import { defineKind, snowflake, type Problem } from './types.js';

export const channelPermissionConfig = z.object({
  /** «Доступ к картинкам и GIF» grants both (015 §2). */
  permissions: z.array(z.enum(['AttachFiles', 'EmbedLinks'])).min(1).max(2),
  channelIds: z.array(snowflake).max(25),
  roleId: snowflake.nullable(),
});
export type ChannelPermissionConfig = z.infer<typeof channelPermissionConfig>;

export const channelPermissionKind = defineKind<ChannelPermissionConfig>({
  configSchema: channelPermissionConfig,
  settable: ['channelIds'],
  guildIdKeys: ['channelIds', 'roleId'],
  sharedResource: true,

  async validate(good, env) {
    const { gateway } = env;
    const problems: Problem[] = [];
    const warnings: Problem[] = [];
    if (!(await gateway.roleManageable(null)).botCanManageRoles) return { problems: [{ code: 'no_manage_roles' }], warnings };

    // The role id is saved the moment it exists, so a crash never creates a second role.
    const roleId = await gateway.ensureRole({
      currentId: good.config.roleId,
      name: good.name,
      color: 0,
      restyle: false,
      adoptByName: true,
      belowRoleId: null,
      reason: `KiberPride Bot: role of the good «${good.name}» (decision 014 §3.1)`,
      onCreated: (id) => env.saveGoodConfig(good.id, { roleId: id }),
    });
    if (roleId !== good.config.roleId) await env.saveGoodConfig(good.id, { roleId });
    if (!(await gateway.roleManageable(roleId)).belowBot) problems.push({ code: 'role_above_bot' });

    if (good.config.channelIds.length === 0) problems.push({ code: 'no_channels' });
    for (const channelId of good.config.channelIds) {
      const report = await gateway.ensureAccessOverwrites(channelId, roleId, good.config.permissions);
      if (!report.exists) problems.push({ code: 'channel_missing', channelId });
      else if (report.missing.length > 0) problems.push({ code: 'channel_perms', channelId, missing: report.missing });
      if (report.otherRoleIds.length > 0) warnings.push({ code: 'other_role_allows', channelId, roleIds: report.otherRoleIds });
    }
    return { problems, warnings };
  },

  async precheck(good, env) {
    const { gateway } = env;
    const role = await gateway.roleManageable(good.config.roleId);
    if (!role.botCanManageRoles) return [{ code: 'no_manage_roles' }];
    if (!role.exists) return [{ code: 'role_missing' }];
    const problems: Problem[] = role.belowBot ? [] : [{ code: 'role_above_bot' }];
    if (good.config.channelIds.length === 0) problems.push({ code: 'no_channels' });
    for (const channelId of good.config.channelIds) {
      const check = await gateway.checkAccessChannel(channelId, good.config.permissions);
      if (!check.exists) problems.push({ code: 'channel_missing', channelId });
      else if (check.everyoneHas) problems.push({ code: 'everyone_has', channelId });
    }
    return problems;
  },

  async apply(grant, good, env) {
    const roleId = good.config.roleId;
    if (!roleId) throw new Error(`good ${good.id}: its role does not exist yet — validate runs first`);
    return (await env.gateway.setMemberRole(grant.userId, roleId, true)) === 'absent' ? 'absent' : 'applied';
  },

  async revoke(grant, good, env) {
    // A member who is not on the server holds no role; `absent` is as good as done.
    if (good.config.roleId) await env.gateway.setMemberRole(grant.userId, good.config.roleId, false);
  },

  describe(good) {
    const p = new Set(good.config.permissions);
    if (p.has('AttachFiles') && p.has('EmbedLinks')) return 'Картинки, файлы и GIF в выбранных каналах';
    return p.has('AttachFiles') ? 'Картинки и файлы в выбранных каналах' : 'GIF и превью ссылок в выбранных каналах';
  },
});
