# 002. Module layout — domain modules behind ports, a thin Discord adapter, stateless custom_ids, tests on a real Postgres

**Status:** accepted
**Date:** 2026-09-19
**Decided by:** architect (technical)

## Context
Decision 001 §4 fixes domain modules behind service interfaces and thin Discord handlers, and
leaves the exact layout to the architect. Three things force the details:
- The bot must survive restarts with its buttons working, so no interaction may depend on
  memory.
- Money must be idempotent, which a mocked database cannot prove.
- Spec §9 names growth that must not need a rewrite.

## Decision
1. **Tree.**
   `src/main.ts` is the composition root: it wires the services, starts Discord and runs
   recovery.
   `src/config/env.ts` parses the environment with zod.
   `src/db/client.ts` holds the one PrismaClient. `src/db/tx.ts` holds `withTx(fn)` and the
   raw-SQL helpers.
   `src/core/` holds `errors.ts`, `ports.ts` and `clock.ts`. A `DomainError` carries a code
   that maps to a player-facing message.
   `src/modules/<m>/` holds `service.ts` (an exported interface plus its implementation), an
   optional `README.md`, and tests next to the code. The modules are `settings`, `permissions`,
   `economy`, `shop` (with `shop/kinds/<kind>.ts`), `games`, `matches`, `rewards` and
   `logging`.
   `src/discord/` holds `client.ts`, `router.ts`, `customId.ts`, `gateway.ts` (implements the
   ports), `recovery.ts`, `views/` (embeds and component builders, all player text) and the
   handler folders `commands/`, `buttons/`, `selects/`, `modals/` and `events/`.
   `src/jobs/` holds the periodic reconcilers.
2. **Dependency direction:** `discord → modules → core, db`. Modules never import
   `discord.js`. When a module needs something done in Discord, it uses the ports in
   `core/ports.ts`: `GuildGateway` (roles, channels, overwrites, moving members, messages,
   membership) and `AuditLog`. `discord/gateway.ts` implements them, and tests use fakes.
   Between modules the edges are `matches → rewards → economy`, `shop → economy` and
   `* → permissions, settings, logging`, with no cycles. An eslint boundaries rule enforces
   this.
3. **Handlers are thin.** A handler parses the custom_id, defers the reply within Discord's
   3-second window, calls one service method and renders a view. It holds no state between
   interactions. `awaitMessageComponent`, collectors and in-memory maps of pending flows are
   **forbidden**.
4. **custom_id codec** (`discord/customId.ts`): `kp1:<action>:<arg>[:<arg>…]`, at most 100
   characters, parsed and validated with zod.
   - `kp1` is the scheme version: old messages stay decodable after a redesign.
   - Arguments are database ids (integers) or Discord snowflakes, never names or amounts.
   - A multi-step organiser flow carries its choices in the id, for example
     `kp1:mfin:<matchId>:<version>:<winner>`.
   - A choice too big for 100 characters (a team picker) is written to the database as the
     organiser makes it, and never held in memory.
   - The router is a map from `action` to handler. An unknown action gets a polite «кнопка
     устарела».
5. **Shop kind registry:** `shop/kinds/index.ts` exports a map from `kind` to handler. A
   handler has:
   - `configSchema` (zod),
   - `validate(good, gateway)`, called when a good is enabled and at startup,
   - `apply(purchase)` and `revoke(purchase)` (idempotent, through the gateway),
   - `describe(good)`.

   A new kind is one new file plus one line in the map. At startup, a good with an unknown kind
   or a config that fails validation is disabled and logged.
6. **Configuration:** env holds secrets and deployment identity only: `DISCORD_TOKEN`,
   `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DATABASE_URL`, `LOG_LEVEL`, `NODE_ENV`. Everything
   the owner might change lives in the database (decision 003): channels, categories, role
   capabilities, reward amounts, goods and the game catalogue. It is edited from the admin
   panel and seeded by `prisma/seed.ts`. One deployment serves one guild.
7. **Extension points named for §9:**
   - `TxKind` in economy (daily, transfer, achievement: a new kind plus a reference format);
   - the shop kind registry (roles, colours, temporary roles);
   - the `games` catalogue table (new games and formats);
   - `RewardRule` rows (new reward events);
   - `jobs/` (expiry, daily reset);
   - profile statistics derived from `Participant` and `KpTransaction`, with no counters to keep
     in sync.
8. **Tests:** two Vitest projects.
   - `unit` has no database and uses fakes for the ports. It covers the codec, views, guards
     and kind handlers.
   - `db` runs against a **real PostgreSQL 16**: migrations applied in globalSetup, tables
     truncated before each test, files run in sequence. Locally it uses the `postgres-test`
     service in `docker-compose.dev.yml`. On GitHub Actions it uses a `postgres:16` service
     container.
   - A missing database **fails** the suite. Skipping it is forbidden.
   - The first test: ten concurrent `economy.move` calls with one reference, on separate pool
     connections, leave exactly one ledger row, a balance moved once, and
     `sum(ledger) = balance`.

## Rejected
- **Mocking Prisma for money and roster tests.** A mock passes an idempotency test with no
  unique index at all. It pins the builder's error.
- **Testcontainers.** A slow first run on Windows and Docker Desktop, and one more moving part;
  a fixed compose service does the same job.
- **Collectors or in-memory flow state.** It dies with a restart, which breaks rule
  `bot-always-on` §1.
- **Encoding the whole state or amounts in custom_id.** A player can forge a custom_id. Ids are
  looked up and re-checked on every press.
- **A layered layout (`controllers/services/repositories`).** It scatters one domain across
  folders, and growth arrives by domain.
- **Product configuration in env or JSON files.** Every change would need a redeploy by the
  agent, and the owner could not change a reward from the panel.

## Consequences
Easier: a new good kind, game or reward event is additive, and domain logic is testable without
Discord. Harder: `npm run check` needs Docker running locally, and the preflight must say so.
Watch: side effects in Discord are never inside a database transaction. They are replayed by
reconcilers (decision 004 §6, `jobs/`), so every gateway call must be idempotent.
