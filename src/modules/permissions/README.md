# permissions — who may do what

- **Owns:** `RoleCapability` rows (role → capability); the one place rights are checked.
- **Interface:** `PermissionsService` in `service.ts` — `can(member, capability)`, `canAny(member, capabilities)`, `canManageMatch(member, {createdById})` (the creator or `MATCH_MANAGE_ANY`, decision 008 §6), `rolesWith(capability)` (voice overwrites for organisers, 008 §7); `MemberFacts` carries no discord.js types.
- **Extension point:** the `Capability` enum in `prisma/schema.prisma` — a new right is one enum value plus its rows.
- **Invariant:** the guild owner and Discord Administrator hold every capability implicitly (unit-tested).
- **Status:** implemented; no admin panel for editing capabilities yet.

Last verified: 2026-09-20
