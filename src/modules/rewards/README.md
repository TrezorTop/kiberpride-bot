# rewards — how much a match pays

- **Owns:** `RewardRule` rows (event × optional game; a game's own rule overrides the default). Raw-SQL `CHECK (amount >= 0)`: a negative reward would debit players (decision 008 §11).
- **Interface:** `RewardsService` in `service.ts` — `resolveFor(gameId)` (default rules, then the game's own on top; a missing rule is 0), `defaults()` (the settings screen). `scaleRewards(amounts, 1|2)` for the ⭐ special match (decision 009 §1).
- **Extension point:** a new reward event is a `RewardEvent` value plus its rows (decision 002 §7).
- **Rule:** amounts are snapshotted into `Match.rewards` at creation (and recomputed ×2/×1 by the special toggle) and paid through `economy.move` by the matches finish (decision 004 §4); a rule changed later never changes an open match.
- **Depends on:** `db` only (the payout itself lives in `matches/payout.ts`).

Last verified: 2026-09-20
