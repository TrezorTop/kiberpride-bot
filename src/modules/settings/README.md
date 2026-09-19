# settings — guild-wide configuration

- **Owns:** the `GuildSettings` singleton (id = 1): log channel, panel channel, default recruitment channel and voice category, auto-move, `recruitTimeoutHours` (default 3, 0 = never, raw-SQL `CHECK >= 0`, decision 009 §5).
- **Interface:** `SettingsService` in `service.ts` — `get` (creates the row on first read), `update`; `RECRUIT_TIMEOUT_CHOICES` (0/1/2/3/6/12/24 h).
- **Extension point:** a new setting is a column plus a panel field; never env, never code (decision 002 §6).
- **Status:** the log channel, recruit channel, voice category, auto-move and recruit timeout are edited on the `/игры` → `⚙️ Настройки` screen (decision 008 §2); the admin panel (spec §7) is not built yet.
- **Depends on:** `db` only.

Last verified: 2026-09-20
