# economy — KP Coin

- **Owns:** `User.balance` and the `KpTransaction` ledger; the only writer of balances (decision 003 §4).
- **Interface:** `EconomyService` in `service.ts` — `ensureUser`, `move` (idempotent by `reference`, joins the caller's `tx`), `history`, `historyPage(userId, page, size = 10)` («Вся история», newest first, page clamped), `devTopUp(actor, nonce, nodeEnv)` («🧪 +10 000 KP Coin», reference `dev:<nonce>`, guild owner outside production only — decision 014 §12).
- **References (003 §3, 014):** `match:<id>:<event>:<userId>`, `purchase:<purchaseId>:<period>`, `refund:<purchaseId>`, `daily:<userId>:<moscowDay>`, `voice:<userId>:<moscowDay>:<hour>`, `admin:<nonce>`, `dev:<nonce>`. `TxKind` gained `DAILY_BONUS` and `VOICE_TIME`.
- **Extension point:** `TxKind` — a new KP source (transfer, achievement) is a new kind plus a reference format.
- **Status:** implemented; concurrency, paging, dev top-up and constraint tests in `service.db.test.ts`.
- **Depends on:** `core`, `db`, `permissions` (the dev-tools check only).

Last verified: 2026-09-20
