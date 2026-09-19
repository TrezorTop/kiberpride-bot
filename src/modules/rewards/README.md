# rewards — how much a match pays

- **Owns:** `RewardRule` rows (event × optional game; a game's own rule overrides the default).
- **Interface:** `RewardsService.resolveFor(gameId)` in `service.ts` (interface only; not built yet).
- **Extension point:** a new reward event is a `RewardEvent` value plus its rows (decision 002 §7).
- **Rule:** amounts are snapshotted into `Match.rewards` at creation and paid through `economy.move` (decision 004 §4).
- **Depends on:** `economy`, `settings`, `logging`.
