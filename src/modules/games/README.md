# games — the game catalogue

- **Owns:** `Game` rows (slug, name, emoji, default team size, enabled), seeded by `prisma/seed.ts`.
- **Interface:** `GamesService` in `service.ts` — `listEnabled()` (enabled games, the first 25 by id: one Discord select, decision 008 §3), `get(id)` (any game, enabled or not; the caller checks `enabled`).
- **Extension point:** a new game or format is a row, not code (decision 002 §7).
- **Status:** implemented; seeded with CS2, Valorant, Dota 2, Мафия. No editing screen yet (admin panel, spec §7).
- **Depends on:** `db` only.

Last verified: 2026-09-20
