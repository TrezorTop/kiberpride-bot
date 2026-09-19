# jobs — periodic reconcilers

- **Owns:** nothing in the database; repairs Discord and time-driven state from it.
- **Built:** `recruitTimeout.ts` — every minute, cancels RECRUITING matches older than `GuildSettings.recruitTimeoutHours` (default 3, 0 = never) through `matches.cancelStaleRecruitments`, the same cancel path as the organiser's (decision 009 §5). `staleCutoff(now, hours)` is the decision logic; the clock is injected; a pass never overlaps the previous one; it idles until the guild is bound. Started from `src/main.ts`.
- **Planned (not built):** purchase grants with `appliedAt IS NULL` and expired purchases (decision 003 §6); a periodic re-sync of matches with `syncedVersion < version` (today a failed sync is repaired by the next change, by opening the match panel, or at restart); nightly ledger drift check `sum(ledger) = balance` (003 Rejected).
- **Rule:** every job is idempotent and safe to run twice or after a crash; no state in memory between runs.
- **Extension point:** a new periodic duty (expiry, daily reset, §9 growth) is one file here, wired in `src/main.ts`.
- **Depends on:** `modules/*` services and `core/ports` — never discord.js directly.

Last verified: 2026-09-20
