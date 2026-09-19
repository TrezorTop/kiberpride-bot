# 004. Match state machine — conditional-update transitions, one-transaction payout, a Discord view reconciled from the database

**Status:** accepted
**Date:** 2026-09-19
**Decided by:** architect (technical)

## Context
Spec §6 lists the guarantees: no double join, no join after close, no finish twice, no double
reward, no MVP who did not play, no winner before teams. A restart must not break active
matches. Discord calls cannot join a database transaction, so the database decides and Discord
follows.

## Decision
1. **States:** `RECRUITING → TEAMS_PENDING → IN_PROGRESS → FINISHED`, with `CANCELLED` reachable
   from every non-terminal state. FINISHED and CANCELLED are terminal. The only way back is
   `TEAMS_PENDING → RECRUITING` (reopen).

2. **Transitions** («creator/admin» means the match's creator or any holder of
   `MATCH_MANAGE_ANY`, per Q5 meanwhile):

   | Transition | Trigger | Who | Guard |
   |---|---|---|---|
   | create → RECRUITING | panel form | `ACTIVITY_CREATE` | game enabled, channel and category set |
   | join / leave | player button | any non-bot member | status RECRUITING; the rules of 003 §10 |
   | RECRUITING → IN_PROGRESS (AUTO) | the last join, **in the same transaction** | system | count = capacity; teams split by `crypto.randomInt` Fisher-Yates |
   | RECRUITING → TEAMS_PENDING (MANUAL) | the last join, same transaction | system | count = capacity |
   | assign a player to A/B | picker select | creator/admin | TEAMS_PENDING; written to `Participant.team` |
   | TEAMS_PENDING → IN_PROGRESS | «Подтвердить команды» | creator/admin | exactly `teamSize` per team; version matches |
   | remove a participant | panel | creator/admin | RECRUITING or TEAMS_PENDING; TEAMS_PENDING reopens and clears teams |
   | IN_PROGRESS → FINISHED | finish flow | creator/admin | winner ∈ {A, B, DRAW}; MVP is a Participant with a team; version matches |
   | any non-terminal → CANCELLED | «Отменить» plus confirmation | creator/admin | no KP moves |

3. **Atomic transitions.** Every transition is one transaction that opens with
   `UPDATE "Match" SET status = $to, version = version + 1, … WHERE id = $id AND status = $from
   [AND version = $v] RETURNING *`. No row back is a `DomainError`: «матч уже завершён» or
   «панель устарела, открой заново».
   - The status guard is always present. That guard is what makes a second finish, or a join
     after close, impossible.
   - The version guard is added to organiser flows whose custom_id carries the version they
     rendered (finish confirm, team confirm, cancel confirm), so a stale panel cannot act.

4. **The finish flow is stateless.**
   `kp1:mfin:<id>` → winner buttons `kp1:mwin:<id>:<v>:<A|B|D>` → MVP select
   `kp1:mmvp:<id>:<v>:<w>` → confirm `kp1:mcfm:<id>:<v>:<w>:<mvpUserId>`. The last one runs a
   **single transaction**: the status transition, winner and MVP, then `economy.move` for every
   reward.
   - Participation goes to every participant with a team and no `leftServerAt`.
   - WIN goes to the winning team; on a DRAW, the DRAW amount goes to both teams (skipped when
     the amount is 0).
   - MVP goes to the MVP.
   - Amounts come from `Match.rewards`. References follow 003 §3.

   A replayed confirm fails the status guard. Even if code were ever to pay twice, the
   reference makes the second payment a no-op. That is two independent layers.

5. **A player leaves the server** (`guildMemberRemove`, plus a membership check at startup for
   events missed while offline):
   - In RECRUITING: removed like a leave.
   - In TEAMS_PENDING: removed, and the match reopens to RECRUITING.
   - In IN_PROGRESS: `leftServerAt` is set and the player stays on the roster. At finish their
     rewards are **withheld** and each withheld amount is logged with its would-be reference.
     A later manual payment from the admin panel uses that **same** reference, so it cannot
     double (Q2 meanwhile).
   - Their balance and purchases are kept. `guildMemberAdd` re-applies their active grants.

6. **Discord follows the database.** `matches.sync(id)`:
   - renders the recruitment message from the database (counter, rosters, buttons disabled in
     terminal states);
   - makes sure the voice channels exist from TEAMS_PENDING on (organiser-only overwrites),
     with team overwrites from IN_PROGRESS on (moving members if `autoMoveToVoice`), and
     deleted in terminal states, with the ids nulled;
   - posts the result;
   - finally sets `syncedVersion = version`.

   Channel ids are saved the moment Discord returns them. `sync` runs after every committed
   transition and, **on startup, for every match with a non-terminal status or
   `syncedVersion < version`**. A deleted recruitment message is reposted and its new id
   stored. Voice channels in managed categories named `🔵 Команда A` / `🔴 Команда B` that no
   open match references are deleted as orphans.

   Calls to `sync` are serialised per match by an in-process keyed queue. That queue holds no
   state: losing it on a restart is repaired by the startup sync. Buttons work after a restart
   even before the sync, because custom_ids carry only ids (002 §4).

7. **Logging:** each transition, payout line, withheld reward, removal and sync failure goes to
   pino and to the log channel, with ids and amounts.

## Rejected
- **A separate FULL state.** Automatic mode goes straight to IN_PROGRESS in the join
  transaction, and manual mode is TEAMS_PENDING. FULL would be a state that no one acts on.
- **A FINISHING state with a separate payout step.** Payout fits in the finish transaction
  (at most 20 players), and a half-paid match cannot exist.
- **Doing Discord calls inside the transaction.** Holding row locks across network calls and
  getting no rollback of Discord anyway.
- **A job or outbox table for side effects.** `syncedVersion` plus the idempotent `sync` covers
  it with one column.
- **Only the creator may finish.** It contradicts Q5 meanwhile; an absent creator would block
  payout forever.
- **Rewards for players who left, paid automatically.** It contradicts Q2 meanwhile.

## Consequences
Every §6 guarantee is a database guard with a concurrent test. A transition that commits while
the sync fails leaves a correct database and a stale message, which the next sync repairs. The
log channel shows the failure. Watch: when Q2, Q3 or Q5 are answered, amend this record with a
superseding one; the table in §2 is the place.
