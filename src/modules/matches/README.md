# matches — recruitment to result

- **Owns:** `Match` and `Participant`; the state machine of decision 004 (RECRUITING → TEAMS_PENDING → IN_PROGRESS → FINISHED, CANCELLED; the one way back is a reopen TEAMS_PENDING → RECRUITING).
- **Interface:** `MatchesService` in `service.ts` (decision 008 §12, 009):
  - `create(actor, {gameId, teamSize|0, teamMode, title|null, recruitChannelId}) → {matchId}` — rights, game, category, bot permissions; snapshots `rewards.resolveFor`; awaits the first sync.
  - `get(id)`, `listOpen(limit)`.
  - `join(id, userId)`, `leave(id, userId)` — `join` refuses `BUSY_IN_MATCH` while the player is a non-left participant of any IN_PROGRESS match (009 §2); the last seat closes the roster in the same transaction (AUTO: random split; MANUAL: TEAMS_PENDING).
  - `removeParticipant(actor, id, userId)`, `assignTeamA(actor, id, userIds) → version`, `confirmTeams(actor, id, v)`.
  - `setSpecial(actor, id, on) → version` — ⭐ ×2, RECRUITING only, rewards recomputed from the settings ×2 / ×1 (009 §1).
  - `finish(actor, {id, version, winner, mvpUserId|null}) → {paid, withheld}` — `null` = «Без MVP» (009 §3).
  - `cancel(actor, id, v)`; `cancelStaleRecruitments(cutoff)` — the recruit timeout's path, system actor (`endedById = null`).
  - `memberLeft(userId)`, `reconcileMembership()` (004 §5, 008 §9).
  - `addTestPlayers(actor, id)` — guild owner, not production (`testPlayers.ts`).
  - `sync(id)`, `enqueueSync(id)`, `needingSync()`, `cleanupOrphans()`, `idle()`.
- **Files:** `service.ts` (transitions), `sync.ts` (Discord follows the database), `syncQueue.ts` (coalescing, 008 §5), `payout.ts` (the pure payout plan the finish applies and the result card renders), `shuffle.ts` (crypto Fisher–Yates), `constants.ts`, `testPlayers.ts`.
- **Invariants:** every transition is one transaction that locks the Match row first (a status-guarded UPDATE, or SELECT … FOR UPDATE where the next step depends on the old status), plus the version guard on organiser confirms; `participantCount = count(Participant)`; services check rights themselves (`actor: MemberFacts`).
- **Rights:** create — `ACTIVITY_CREATE`; everything on an existing match — the creator or `MATCH_MANAGE_ANY` (`permissions.canManageMatch`).
- **References:** `match:<id>:participation|win|draw|mvp:<userId>`; a draw is kind `MATCH_BONUS` so win statistics never count it. Withheld lines are logged with the same reference a manual payment must use.
- **Lock order:** the finish pays in ascending `userId` order, so two finishes sharing players cannot deadlock (decision 007).
- **Sync:** voice channels first (`🔵 Команда A · #<id>`, overwrites replaced in full, fake ids never passed), then the recruitment message (reposted if deleted), then one announcement per status (`announcedStatus`), orphan cleanup after a terminal sync, finally `syncedVersion = v WHERE syncedVersion < v`. It never bumps `version`.
- **Tests:** `tests/db/matches/*.db.test.ts` (real Postgres, concurrent presses on separate connections; `tests/fakes/gateway.ts` runs the production `core/ensureChannel.ts`), `matches.test.ts` (unit).
- **Depends on:** `rewards`, `economy`, `games`, `permissions`, `settings`, `logging`; `core/ports` for Discord.

Last verified: 2026-09-20
