# matches — recruitment to result

- **Owns:** `Match` and `Participant`; the state machine of decision 004 (RECRUITING → TEAMS_PENDING → IN_PROGRESS → FINISHED, CANCELLED).
- **Interface:** `MatchesService` in `service.ts` — `join`, `leave`, `finish`, `cancel`, `sync`, `needingSync` (interface only; not built yet).
- **Extension point:** new formats are `teamSize` (2..10); new team modes extend `TeamMode`; statistics derive from `Participant` + the ledger.
- **Invariant:** every transition is one transaction opening with a conditional UPDATE on status (+ version); Discord follows via `sync`.
- **Depends on:** `rewards`, `economy`, `games`, `permissions`, `settings`, `logging`.
