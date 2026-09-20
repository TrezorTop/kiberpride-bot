# 022. The database belongs to one guild; a Discord id from another guild counts as absent

**Status:** accepted (narrows 008 §7; amends 014 §3; one migration)
**Date:** 2026-09-20
**Decided by:** architect (technical), after the live go-live of 2026-09-20

## Context
The bot moved from the test guild to the real KiberPride server. `GuildSettings.logChannelId`
still held the test guild's channel, so `ensureLogChannel` fetched it, got
`DiscordAPIError[50001] Missing Access`, and from then on every log-channel post failed and the
heartbeat never reached Discord. The lead repaired it by nulling the stored ids by hand.

Every stored Discord id has the same shape of problem: the settings' channels and category, the
shop's role, channels, category and anchor role, a match's channels and message, a clan's role, a
room's channel.

## Decision
1. **One rule for «this id is not there»** (`src/discord/missing.ts`): a fetch that fails with
   `10003 Unknown Channel`, `10011 Unknown Role`, `10004 Unknown Guild`, `50001 Missing Access`
   or discord.js's own `DiscordjsError[GuildChannelUnowned]`, **or** returns an object whose
   `guildId` is not the served guild, is handled as absent: the id is forgotten and the thing is
   created or chosen again. Every stored-id resolution in the gateway goes through one
   guild-checked helper.
   `GuildChannelUnowned` is the case while the bot is STILL a member of the other guild (review
   2026-09-20): `GuildChannelManager.fetch` gets the channel, sees `guild_id` is not this guild's
   and throws its own error class — never a `DiscordAPIError`, so the 50001 rule alone misses it
   and the `guildId` comparison after the fetch is never reached. That comparison still carries
   the cache-hit paths (`roleById`) and any collection walked in memory.
2. **`50013 Missing Permissions` is NOT «absent».** The object exists and is visible; forgetting
   its id would silently leak a channel in the guild we do serve. It still fails loudly.
3. **A guild change is noticed at bind.** `GuildSettings.guildId` records the guild the database
   belongs to. On start: null → record it; equal → nothing; different → one warning line and one
   transaction that nulls `logChannelId`, `panelChannelId`, `defaultRecruitChannelId`,
   `defaultVoiceCategoryId` and each shop good's Discord ids. Every shop kind declares which of
   its config keys are Discord ids (`guildIdKeys`), so a new kind cannot silently keep a stale
   one.
4. **No match row is touched by that pass.** `Match.recruitChannelId` and `voiceCategoryId` are
   NOT NULL, and `DISCORD_GUILD_ID` may be empty in production, so the guild is derived: an
   accidental rebind must never cancel live matches or lose their payouts. Instead, `sync` checks
   the recruit channel first and, when it does not resolve, stops before any Discord work and says
   so once per (match, version) in the log channel («бот не видит канал набора — верни доступ, или
   отмени матч в «/игры»»). A person cancels the match; cancelling needs no Discord. Without this
   guard, matches left over from another guild would poison `BUSY_IN_MATCH` and the open-matches
   list forever, because both queries are guild-blind.
   **`syncedVersion` is NOT stamped there** (review 2026-09-20): the same `NotFound` is what a
   50001 on a channel in the SERVED guild produces — an admin denies the bot View, a category sync
   wipes its overwrite — and that is repairable in one click. The match stays in `unsynced()`, the
   minute job keeps retrying it, and access given back makes the message catch up by itself. The
   cost of retrying is one `checkRecruitChannel` call per minute per such match; the cost of
   stamping was a frozen message until the next restart.
5. **Clan roles and personal rooms are not nulled.** `ensureRole` and `ensureRoomChannel`
   re-create them lazily under rule 1, which is better than an eager write.
6. **The log channel heals itself.** `ensureLogChannel` is single-flight and cached; every post
   ensures first, and a failed post forgets the cache. The heartbeat no longer depends on one
   attempt at bind.
7. **Layering.** `modules/settings` may not import another module (002 §2), so the shop's id
   knowledge reaches the guild-change pass as an injected patch, wired in `src/main.ts`.

## Rejected
- **Cancelling leftover matches automatically on a guild change.** Irreversible, and it would fire
  on an accidental rebind.
- **Treating `50013` as absent.** It would leak channels in the served guild.
- **A per-site `isUnknown` check.** Seven sites, each free to forget a case; one helper is the
  invariant.

## Consequences
Moving the bot to another Discord server is now safe: stored ids are dropped and rebuilt, prices,
rights, balances, purchases and history stay. `DISCORD_GUILD_ID` must still be set while the bot is
in more than one guild. One harmless detail, recorded so a later reader does not «fix» it:
`cleanupOrphans` keeps a foreign `voiceCategoryId` in its category list for the 7-day window, and
`listVoiceChannels` simply matches nothing for it.

**Filed by the review of 2026-09-20, each due 2026-09-27** — known, not fixed in this change:

1. **`deleteChannel` forgets the id of a channel it merely cannot see.** It treats every
   `isMissing` error as «deleted», and 50001 is now one of them, so a team channel in the SERVED
   guild whose View was taken away is dropped from the match and leaks forever. The delete path
   needs a narrower rule than the read path (10003 only, plus `GuildChannelUnowned`).
2. **The guild-change pass writes `guildId` unconditionally.** Two starts racing, or a write
   landing after another bind, can record a guild the nulling pass did not run for. It needs a
   compare-and-set: `where: { id: 1, guildId: stored }`, and «no row updated» means «read again».
3. **`logging/service.ts` re-ensures on every log line after a failure.** When the failing step is
   `channels.create` (no Manage Channels), a burst of events becomes a burst of create attempts
   against Discord. It needs a back-off on the ensure, distinct from the cache-forgetting on a
   failed post, which is right as it stands.
