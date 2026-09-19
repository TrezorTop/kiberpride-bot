# 001. Stack and hosting shape — TypeScript + discord.js + PostgreSQL, one small VPS outside Russia

**Status:** accepted
**Date:** 2026-09-19
**Decided by:** architect (harness author, at the owner's request while setting up the
repository). The project architect may revise any technical part AT ANY MOMENT with a
superseding record (owner's decision 2026-09-19); the hosting constraints (§Decision 5–6) come
from the owner's situation and are not revisable by the architect.

## Context

The owner is non-technical and will never operate the bot; the agent builds, runs and maintains
it alone. The bot is a single long-running process with a relational state (balances,
transactions, matches, sign-ups) that must survive restarts and serialise concurrent button
presses. The owner is in Russia; Discord is blocked there, and foreign cards do not work from
Russia. The repository is public.

## Decision

1. **Runtime and language:** Node.js LTS (22 at the time of writing), TypeScript strict. The
   largest body of Discord bot knowledge the builder can draw on; one language across code,
   tools and tests.
2. **Discord library:** `discord.js` v14 — slash commands, buttons, select menus, modals and
   embeds are first-class; the interaction model maps one-to-one onto the brief.
3. **Database:** PostgreSQL 16 in a Docker container next to the bot; **Prisma** as the ORM with
   migrations in the repository. Row-level uniqueness and transactions carry the idempotency
   rules of rule `bot-always-on` (unique reference per KP movement, unique player per match).
4. **Structure:** modules by domain (`economy`, `shop`, `games`, `matches`, `rewards`,
   `permissions`, `logging`) behind service interfaces; Discord handlers (commands, buttons,
   selects, modals, events) are thin and call services. Shop goods are a `kind` with a handler
   registry, so a new kind is a new file, not a rewrite. The exact layout is the architect's at
   `/init-project`.
5. **Hosting:** one small VPS (1–2 vCPU, 2 GB RAM, 20 GB disk) located **outside Russia** —
   Discord's API is blocked from inside — at a provider that **accepts ruble payment** from a
   Russian card and lets the SSH public key be set at server creation. Shortlist to verify at
   the time of purchase (prices and locations change): Timeweb Cloud (Netherlands / Poland /
   Germany locations), Aeza (several EU locations). Ubuntu LTS.
6. **Deployment:** Docker Compose on the server (`bot` + `postgres`), images built on the server
   from the repository over SSH by the agent (`runbooks/deploy.md`); `restart: unless-stopped`,
   a health check, nightly `pg_dump`. No CI/CD pipeline to the server in the first release — the
   agent is the pipeline; GitHub Actions runs only the project gate on pull requests.
7. **Quality gate:** `npm run check` = typecheck + lint + tests (Vitest). Green is the definition
   of done for code (rule `work-order-and-doc-sync` §4).
8. **Logging:** `pino` to stdout plus a Discord log channel transport for the actions listed in
   the spec; a heartbeat message on start carrying the version.
9. **Local runs** on the owner's Windows machine for tests: Docker Desktop for PostgreSQL, the
   bot via `npm run dev`, pointed at a private test Discord server.

## Rejected

- **Python / discord.py** — fine library, but the TypeScript path gives one language for the
  bot, the tools and the harness scripts, and stronger typing for a state machine.
- **SQLite** — no concurrent-write story worth trusting for ten simultaneous button presses, and
  the brief asked for a real database explicitly.
- **A managed platform (Railway, Fly, Render)** — foreign payment only; unusable from Russia.
- **A VPS inside Russia** — cheaper and easier to pay, but cannot reach Discord's API reliably.
- **GitHub Actions deploying to the server** — needs the SSH key as a repository secret in a
  public repository and a second thing to debug; the agent already has the key locally.

## Consequences

Easier: one language, one process, one server, one runbook. Harder: the owner must buy the
server and paste one key (walked through in `runbooks/server-setup.md`); Docker Desktop must
be installed on the owner's machine for local tests (done by the agent in
`runbooks/workstation-setup.md`). Watch: provider availability and ruble payment — re-verify at
purchase time, not from this record.
