# economy — KP Coin

- **Owns:** `User.balance` and the `KpTransaction` ledger; the only writer of balances (decision 003 §4).
- **Interface:** `EconomyService` in `service.ts` — `ensureUser` (race-proof: `ON CONFLICT DO NOTHING`, never `upsert`), `move` (idempotent by `reference`, joins the caller's `tx`), `history`, `historyPage(userId, page, size = 10)` («Вся история», newest first, page clamped), `devTopUp(actor, nonce, nodeEnv)` («🧪 +10 000 KP Coin», reference `dev:<nonce>`, guild owner outside production only — decision 014 §12), `adminAdjust(actor, input)` (`/начислить`, decision 021).
- **`adminAdjust(actor, { userId, amount, reason, nonce, targetIsBot })`:** needs `ECONOMY_ADMIN` — the command's visibility is not the guard (decision 020 §3). Amount is signed, non-zero, at most `ADMIN_ADJUST_MAX` (1 000 000) either way; a bot target is refused; paying oneself is allowed and logged. Taking more than the player has throws `BALANCE_TOO_LOW` carrying their balance, and nothing is written — checked before the move for the message, and again by `move`'s conditional update under the row lock. `adminAdjustDescription` builds the history line («начислено администратором» when no reason).
- **References (003 §3, 014, 021):** `match:<id>:<event>:<userId>`, `purchase:<purchaseId>:<period>`, `refund:<purchaseId>`, `daily:<userId>:<moscowDay>`, `voice:<userId>:<moscowDay>:<hour>`, `admin:<nonce>` (`/начислить`: the nonce is the interaction id, so a redelivered command pays once), `dev:<nonce>`. `TxKind` gained `DAILY_BONUS` and `VOICE_TIME`.
- **Extension point:** `TxKind` — a new KP source (transfer, achievement) is a new kind plus a reference format.
- **Status:** implemented; concurrency, paging, dev top-up, admin adjustment and constraint tests in `service.db.test.ts`; the pure history-line helper in `service.test.ts`.
- **Depends on:** `core`, `db`, `permissions` (the dev-tools check and `ECONOMY_ADMIN`; `createEconomyService(db, { permissions })`, and without one it builds a service over the same `db`).

Last verified: 2026-09-20
