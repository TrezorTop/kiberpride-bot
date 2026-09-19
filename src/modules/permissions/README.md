# permissions — who may do what

- **Owns:** `RoleCapability` rows (role → capability); the one place rights are checked.
- **Interface:** `PermissionsService.can(member, capability)` in `service.ts`; `MemberFacts` carries no discord.js types.
- **Extension point:** the `Capability` enum in `prisma/schema.prisma` — a new right is one enum value plus its rows.
- **Invariant:** the guild owner and Discord Administrator hold every capability implicitly (unit-tested).
- **Status:** implemented; no admin panel for editing capabilities yet.
