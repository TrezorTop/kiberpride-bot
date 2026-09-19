# jobs — periodic reconcilers

- **Owns:** nothing in the database; repairs Discord and time-driven state from it.
- **Built:** `recruitTimeout.ts` — every minute, cancels RECRUITING matches older than `GuildSettings.recruitTimeoutHours` (default 3, 0 = never) through `matches.cancelStaleRecruitments`, the same cancel path as the organiser's (decision 009 §5). `staleCutoff(now, hours)` is the decision logic; the clock is injected; a pass never overlaps the previous one; it idles until the guild is bound. Started from `src/main.ts`.
- **Built:** `syncRetry.ts` — every minute, enqueues every match with `syncedVersion < version` (`matches.unsynced()`, terminal matches included, since their final render may be what failed); failures reach the log channel once per (match, version) per process (decision 010 §3). Known gap, filed for 2026-10-04: a sync that fails for good (the recruit channel deleted) is retried every minute forever with a process-log error each time — needs a backoff or a terminal «channel gone» handling.
- **Planned (not built):** purchase grants with `appliedAt IS NULL` and expired purchases (decision 003 §6); nightly ledger drift check `sum(ledger) = balance` (003 Rejected).
- **Rule:** every job is idempotent and safe to run twice or after a crash; no state in memory between runs.
- **Extension point:** a new periodic duty (expiry, daily reset, §9 growth) is one file here, wired in `src/main.ts`.
- **Depends on:** `modules/*` services and `core/ports` — never discord.js directly.

Last verified: 2026-09-20
