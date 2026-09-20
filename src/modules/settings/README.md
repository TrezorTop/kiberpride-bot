# settings — guild-wide configuration

- **Owns:** the `GuildSettings` singleton (id = 1): `guildId` (the server every id below belongs to), log channel, panel channel, default recruitment channel and voice category, auto-move, `recruitTimeoutHours` (default 3, 0 = never, raw-SQL `CHECK >= 0`, decision 009 §5).
- **Interface:** `SettingsService` in `service.ts` — `get` (creates the row on first read), `update`; `RECRUIT_TIMEOUT_CHOICES` (0/1/2/3/6/12/24 h); `SINGLETON_ID`.
- **Guild binding (`guildChange.ts`, 2026-09-20):** `bindGuildSettings(deps, guildId)` runs at every bind (`src/discord/client.ts`). `guildId` null → it is recorded and NOTHING else changes (an upgrade in place must not lose a valid log channel: `ensureLogChannel` has no adopt-by-name path). `guildId` equal → no-op. `guildId` different → one transaction nulls `logChannelId`, `panelChannelId`, `defaultRecruitChannelId`, `defaultVoiceCategoryId` and drops the shop goods' Discord ids, then stores the new guild; prices, rights, balances, purchases and matches are untouched. The shop's ids are declared by each kind (`shop/kinds`' `guildIdKeys`) and reach this module as the injected `goodIdsPatch` — `modules/settings` imports no other module (decision 002 §2), so `src/main.ts` wires it.
- **Extension point:** a new setting is a column plus a panel field; never env, never code (decision 002 §6).
- **Status:** the log channel, recruit channel, voice category, auto-move and recruit timeout are edited on the `/игры` → `⚙️ Настройки` screen (decision 008 §2); the admin panel (spec §7) is not built yet.
- **Depends on:** `db` only.
- **Tests:** `tests/db/settings/guildChange.db.test.ts`.

Last verified: 2026-09-20
