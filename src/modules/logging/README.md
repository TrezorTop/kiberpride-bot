# logging — pino plus the Discord log channel

- **Owns:** the process logger (`logger.ts`) and the log channel lifecycle (create if missing, heartbeat).
- **Interface:** `LoggingService` in `service.ts` — `event` (info), `failure` (error level: failed syncs, failed jobs), `ensureLogChannel`, `heartbeat`; posts through the `AuditLog` port.
- **The channel ensures itself (2026-09-20):** `ensureLogChannel` is single-flight and cached, and every post ensures first; a failed post forgets the cache, so a channel deleted — or left behind in a server the bot no longer serves — is re-created on the next event. Nothing waits for the bind's one attempt, and the heartbeat never depends on it (rule `bot-always-on` §4).
- **Extension point:** a new audited action is one `event(name, fields, auditLine)` call at the place it happens.
- **Rule:** ids, names and amounts only — never a token or a password (rule no-secrets-in-git §3).
- **Depends on:** `settings`, `core/ports`.

Last verified: 2026-09-20
