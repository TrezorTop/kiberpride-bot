# games — the game catalogue

- **Owns:** `Game` rows (slug, name, emoji, default team size, enabled), seeded by `prisma/seed.ts`.
- **Interface:** `GamesService` in `service.ts` — `listEnabled`, `get` (interface only; not built yet).
- **Extension point:** a new game or format is a row, not code (decision 002 §7).
- **Status:** seeded (CS2, Valorant, Dota 2, Мафия); no service implementation yet.
- **Depends on:** `db` only.
