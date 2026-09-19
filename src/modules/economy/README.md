# economy — KP Coin

- **Owns:** `User.balance` and the `KpTransaction` ledger; the only writer of balances (decision 003 §4).
- **Interface:** `EconomyService` in `service.ts` — `ensureUser`, `move` (idempotent by `reference`, joins the caller's `tx`), `history`.
- **Extension point:** `TxKind` — a new KP source (daily, transfer, achievement) is a new kind plus a reference format (003 §3).
- **Status:** implemented; concurrency and constraint tests in `service.db.test.ts`.
- **Depends on:** `core`, `db` only.
