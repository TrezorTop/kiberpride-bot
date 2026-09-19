# logging — pino plus the Discord log channel

- **Owns:** the process logger (`logger.ts`) and the log channel lifecycle (create if missing, heartbeat).
- **Interface:** `LoggingService` in `service.ts` — `event` (info), `failure` (error level: failed syncs, failed jobs), `ensureLogChannel`, `heartbeat`; posts through the `AuditLog` port.
- **Extension point:** a new audited action is one `event(name, fields, auditLine)` call at the place it happens.
- **Rule:** ids, names and amounts only — never a token or a password (rule no-secrets-in-git §3).
- **Depends on:** `settings`, `core/ports`.

Last verified: 2026-09-20
