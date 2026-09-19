# settings — guild-wide configuration

- **Owns:** the `GuildSettings` singleton (id = 1): log channel, panel channel, default recruitment channel and voice category, auto-move.
- **Interface:** `SettingsService` in `service.ts` — `get` (creates the row on first read), `update`.
- **Extension point:** a new setting is a column plus a panel field; never env, never code (decision 002 §6).
- **Status:** implemented for the log channel id; the admin panel is not built yet.
- **Depends on:** `db` only.
