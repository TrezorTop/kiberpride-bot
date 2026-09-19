# jobs — periodic reconcilers

- **Owns:** nothing in the database; repairs Discord and time-driven state from it.
- **Planned (not built):** purchase grants with `appliedAt IS NULL` and expired purchases (decision 003 §6); match sync for `syncedVersion < version` (decision 004 §6); nightly ledger drift check `sum(ledger) = balance` (003 Rejected).
- **Rule:** every job is idempotent and safe to run twice or after a crash; no state in memory between runs.
- **Extension point:** a new periodic duty (expiry, daily reset, §9 growth) is one file here, wired in `src/main.ts`.
- **Depends on:** `modules/*` services and `core/ports` — never discord.js directly.
