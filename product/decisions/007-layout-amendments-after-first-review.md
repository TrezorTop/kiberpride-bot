# 007. Amendments to 002 after the first review — router defers, optional ids, Prisma 7 adapter, strict references

**Status:** accepted (amends 002 §3 and §6; 003 §4)
**Date:** 2026-09-19
**Decided by:** architect (technical), «refute this» review of the `init/scaffold` step

## Context
The scaffold implemented 002–004 and took several choices the records did not dictate. The
review accepted them and ruled on one of them. The ruling is written down here so that the
records match the code.

## Decision
1. **Deferring is done by the router, not by each handler** (amends 002 §3). Each route declares
   `ephemeral` or `update`. The router defers before it calls the handler, so no handler can
   forget to. If an error happens after an `update` defer, the router sends it to the person who
   pressed as a private follow-up.
2. **Environment** (amends 002 §6):
   - `DISCORD_CLIENT_ID` is optional; it is derived from the token.
   - `DISCORD_GUILD_ID` is optional. If it is unset, the bot serves the only guild it is in.
     Zero guilds means the bot waits for `guildCreate`. More than one guild and no id means the
     bot refuses to start and says why.
   - Added: `APP_VERSION` (the git short SHA, baked at build), `POSTGRES_PASSWORD` (server,
     hex, spliced into `DATABASE_URL`) and `TEST_DATABASE_URL`.
3. **Prisma 7** runs with the `@prisma/adapter-pg` driver adapter. `prisma.config.ts` holds the
   URL. The generated client lives in `src/generated/prisma`; git ignores it, and CI and the
   Dockerfile generate it. `migrate diff` shows that Prisma leaves the hand-written CHECKs and
   partial indexes alone.
4. **A reference is the identity of one economic fact** (sharpens 003 §4). If a reference
   already exists with a different user, amount or kind, `economy.move` **throws**, and it is
   not a silent no-op. A mismatch is always a code bug, such as a reference format collision or
   a reused nonce.
5. **Liveness** (rule `bot-always-on` §4):
   - A reconnect after a drop is posted to the log channel.
   - A watchdog ends the process if Discord has not been ready for 5 minutes; `restart:
     unless-stopped` then brings it back.
   - A failure while binding to the guild ends the process, so the bot never runs half-bound.
6. **Accepted npm audit findings:** 4 high findings in the Prisma CLI's own dependencies
   (`deepmerge-ts`, `mysql2`). The CLI only runs `migrate deploy` on trusted configuration, and
   nothing here uses MySQL. Re-check them on every Prisma upgrade.

## Rejected
- **A silent no-op on a mismatched reference.** It would tell the caller that player X was paid
  when the payment went to player Y.
- **Relying on the health check alone for a stuck bot.** Plain Docker Compose does not restart
  a container that is only unhealthy.
- **Downgrading to Prisma 6 to clear the audit findings.** Those paths are unreachable here, and
  the downgrade costs a second migration of the setup.

## Consequences
When the matches step pays many players in one transaction, it calls `economy.move` in
ascending `userId` order, so two finishes that share players cannot deadlock on user rows.

Two cases are still open for a ruling, filed 2026-09-19 and due at the next architect review:
- The log channel cannot be created, most likely because the bot lacks Manage Channels. Today
  the bot logs this and runs without the channel; exiting instead would restart it in a loop.
- The bot is in no guild or in several guilds without an id. Today it logs this and waits; the
  watchdog does not see it, because the connection is fine.
