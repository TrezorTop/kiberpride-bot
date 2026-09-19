# 011. When a player's match starts, the bot withdraws them from their other recruitments

**Status:** accepted (strengthens 009 §2)
**Date:** 2026-09-20
**Decided by:** owner (product). The mechanics are the lead's choice and go to the architect's
review.

## Context
Under 009 §2, a player whose match has started cannot join another recruitment. The review
(010) noted that this is only checked when a player joins. A player signed up to two
recruitments that both fill ends up in two started matches. The owner was offered two options:
leave it to the organisers, or withdraw the player automatically. The owner chose the
withdrawal: «б».

## Decision
1. When a match becomes IN_PROGRESS, the bot withdraws each of its participants from every
   other match that is RECRUITING or TEAMS_PENDING. The match becomes IN_PROGRESS either by the
   automatic split inside the final join, or by `confirmTeams`. The withdrawal happens in the
   **same transaction**.
   - The Participant row is deleted, the count is decremented and the version is bumped.
   - A TEAMS_PENDING match reopens to RECRUITING with its teams cleared, the same as a removal.
2. The seat becomes free for someone else at once. The affected recruitment messages are synced
   after the commit.
3. Each withdrawal is logged to the process log and the log channel: «игрок … выписан из набора
   #N — начался матч #M». The player is not pinged.
4. **Concurrency.** The other Match rows are locked in ascending id order. Two recruitments that
   share players can fill at the same moment, and each already holds its own lock, so Postgres
   may detect a deadlock. The join and team-confirm transactions therefore retry on 40P01 and
   40001, up to 3 times. The retry re-evaluates everything from scratch.

## Rejected
- **Leave it to the organisers.** The owner wants «one started match at a time» to hold, not
  just to be checked when a player joins.
- **A global advisory lock on joins.** It would serialise every join on the server to remove a
  rare case. The deadlock retry is local and cheap.

## Consequences
A full roster can shrink by itself when one of its players' other matches starts first, and the
organiser sees the seat reopen. Watch: `participantCount = count(Participant)` in every
affected match, covered by the concurrent db test.
