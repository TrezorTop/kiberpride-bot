# 010. Amendments after the matches review — ×2 scales the snapshot, cancel guarded by status, a sync retry job, filed follow-ups

**Status:** accepted. Amends 003 §3, 004 §3, 008 §5, §6, §7 and 009 §1.
**Date:** 2026-09-20
**Decided by:** architect (technical), in the «refute this» review of `feat/recruitment-and-matches`

## Context
The first matches build was reviewed before merge. The builder had taken 17 choices that
decisions 008 and 009 did not dictate. The review accepted most of them, rejected three as
built, and asked for one hardening change. This record writes the rulings down so the records
match the code.

## Decision
1. **×2 scales the creation snapshot** (amends 009 §1). Toggling ⭐ on doubles the stored
   `Match.rewards` and toggling it off halves them. Both happen under `SELECT … FOR UPDATE`,
   and the rewards are never recomputed from current settings. Halving is exact because a
   toggle to the same state is a no-op. This keeps 003's rule that amounts are fixed at
   creation.
2. **Cancel is guarded by the status the panel was rendered in** (amends 008 §6). The custom_ids
   are `mcan:<id>:<v>:<R|T|P>` and `mccf:<id>:<v>:<R|T|P>`. The guard is:
   - the status must still equal the rendered status;
   - the version must also match, unless the rendered status is RECRUITING.

   Joins do not change what «cancel this recruitment» means. A match that started after the
   panel was rendered is still refused.
3. **A job retries failed syncs** (amends 008 §5). Every minute it enqueues each match with
   `syncedVersion < version`. A failure is reported to the log channel once per
   (match, version) per process. Without the job, one transient failure when teams form would
   leave a started match without voice channels until someone opens its panel.
4. **Overwrites carry only roles that exist** (amends 008 §7). The role ids with
   `MATCH_MANAGE_ANY` are filtered to `guild.roles.cache`. A deleted role left in
   `RoleCapability` must not break channel creation.
5. **Choices accepted as built**, recorded here:
   - Leave, remove, cancel and player-left take `SELECT … FOR UPDATE` on Match before the
     status-guarded UPDATE, because the next step depends on the old status. This amends 004
     §3's wording; the serialisation is the same.
   - The sync order is voice channels, then the message, then the announcement. The message
     links the channels.
   - The orphan rule is stricter than 008 §7: a channel whose `#id` names a non-terminal match
     is never deleted.
   - Settings rights are checked in the handlers for now. They move into
     `settings.update(actor, …)` before the §7 admin panel step.
   - A draw pays with the reference `match:<id>:draw:<userId>` and kind `MATCH_BONUS`. This adds
     to 003 §3's list.
   - An auto-closed recruitment is a CANCELLED match with `endedById = NULL`.
6. **`NODE_ENV` defaults to `production`.** The test-players button must fail closed if the
   server is started without the variable. The dev script sets `development` explicitly.

## Rejected
- **×2 recomputed from current settings.** A settings change between creation and the toggle
  would silently change what the recruitment promised.
- **Cancel guarded by the version in every status.** During an active recruitment every join
  bumps the version, so the organiser's cancel keeps going stale.
- **Repairing a failed sync only on the next change or at restart.** A started match gets no
  further changes before its finish.

## Consequences
Filed, due 2026-10-04 unless a line says otherwise:
- (a) The recruit timeout should count from the moment the match last became RECRUITING, not
  from `createdAt`. Today a full match that reopens after the timeout is auto-cancelled within
  a minute. This needs a column set at creation and at every reopen, and a 009 §5 amendment.
- (b) Measure whether Discord accepts a member overwrite for a creator who has left the server.
  If it does not, drop an absent creator from the overwrites.
- (d) Move settings rights into the service. This is due before the §7 admin panel step begins.
- (e) Add db tests for the timeout racing the last join, and for a join by a player who is
  already signed up when one seat is left.

Product note: «one started match at a time» (009 §2) was only checked when a player joined. The
owner settled it the same day in decision 011: the bot now withdraws a player from their other
recruitments when their match starts.
