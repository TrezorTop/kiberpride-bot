# permissions — who may do what

- **Owns:** `RoleCapability` rows (role → capability); the one place rights are checked and the one place they are edited.
- **Interface:** `PermissionsService` in `service.ts` — `can(member, capability)`, `canAny(member, capabilities)`, `canManageMatch(member, {createdById})` (the creator or `MATCH_MANAGE_ANY`, decision 008 §6), `rolesWith(capability)` (voice overwrites for organisers, 008 §7), `listRights()` (capability → role ids, every capability a key) and `setRoles(actor, capability, roleIds)`; `MemberFacts` carries no discord.js types.
- **Wiring:** `createPermissionsService({ ...dbPermissionSources(db), everyoneRoleId })`. `everyoneRoleId` is the guild id, which is also @everyone's role id (`src/main.ts`).
- **Editing:** the `/права` screen (`src/discord/commands/rights.ts`, `views/rights.ts`, `selects/rights.ts`) — a string select picks the capability, a role select holds its roles. `setRoles` needs `SETTINGS_MANAGE`, replaces the whole set for that capability, and refuses @everyone, a non-snowflake, an unknown capability and more than 25 roles. Bot-managed roles are refused in the handler, which is the only layer that sees them. The handler logs the change to pino and the log channel.
- **Extension point:** the `Capability` enum in `prisma/schema.prisma` — a new right is one enum value, one line in `CAPABILITY_TEXT` (`src/discord/views/rights.ts`) and its rows.
- **Invariants:**
  - the guild owner and Discord Administrator hold every capability implicitly (unit-tested), so a fresh server is never locked out;
  - a save replaces the set atomically: two admins saving the same capability at once leave one of their two sets, never a mixture. The savers are serialised by `pg_advisory_xact_lock` on the capability, because a delete cannot lock rows the other side is about to insert (db-tested).
- **Command visibility** is cosmetic and separate from the rights above: `/игры`, `/настройки-магазина` and `/права` carry `default_member_permissions = 0`, so only members whose role has Discord's Administrator permission see them until the owner shows a command to a role in Server Settings → Integrations. Seeing a command grants nothing; every handler still asks this module.
- **Status:** implemented, `/права` included.

Last verified: 2026-09-20
