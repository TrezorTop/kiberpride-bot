# Routes: product feature · infrastructure · rules and docs

The order of work for a task, the stop conditions, and what «done» means. The rules are already
in context (`CLAUDE.md`); this file is the sequence. Read your route before the first edit.

## Route 0 — the empty repository

**Your case when:** there is no `src/` yet. Run `/init-project` (`.claude/skills/init-project/`)
and nothing else; it is the whole first session.

## Route 1 — a product feature or a change in behaviour

**Your case when:** the owner asks for something the bot should do or do differently; a bug a
player would notice.

**Read before the first edit:** `product/spec.md` for the area; `product/open-questions.md`
(the fork may be waiting for the owner — ask it now, as options); the decision records that
touch the area; the module's own README under `src/<module>/` if one exists.

**Order:**

1. Restate the request in one Russian sentence to the owner only if it is ambiguous; otherwise
   start. Product forks → owner (rule `owner-is-product`); technical forks → architect (rule
   `opus-decides-design`), decision record first.
2. Branch from a fresh `main` (rule `github-flow`).
3. Build with tests: every guarantee from `spec.md` §6 that the change touches gets a test that
   fails if the guarantee breaks (double join, double payout, restart recovery).
4. Run it against the test Discord server; walk the flow as a player and as an organiser.
   `npm run check` green, quoted.
5. Doc-sync: `spec.md` if behaviour changed; decision record + question removed if a fork was
   settled; `docs/for-owner/status.md` if the players can now do something new.
6. «Refute this» to a fresh architect; fixes made; pull request; merge; delete the branch.
7. Report to the owner in product terms: what the players can do now, what was checked, what is
   still open (rule `plain-language`).

**Stop — owner only:** anything that changes what players see or pay, the size of a reward, a
right, the go-live to the real server.

**Done when:** merged; the bot on the server (or locally, before go-live) shows the behaviour;
the docs above are updated; the owner has the product-level report.

## Route 2 — infrastructure: server, deploy, secrets, backups

**Your case when:** buying or setting up the server, deploying a version, rotating a token,
restoring a backup, an outage.

**Read before the first edit:** the runbook for the step (`runbooks/`), rule `server-safety`,
rule `no-secrets-in-git`, decision 001 §5–6.

**Order:**

1. Reconnaissance is free: read the server state, the logs, the log channel first.
2. Name the rollback before the change; backup before a change that can lose data.
3. Strictly by the runbook; a runbook that disagrees with the server is fixed in the same pass.
4. Backup after; read the live signal (rule `bot-always-on` §5) and quote it.
5. Report to the owner in one or two plain sentences; the owner's hands are needed only for what
   rule `owner-is-product` §3 lists, prepared to a single paste.

**Stop — owner only:** spending money; anything that needs their account (hosting panel, Discord
developer portal, GitHub sign-in).

**Done when:** the runbook's check passed, both backups exist, the heartbeat shows the new
version, the runbook and `docs/for-owner/status.md` say what is live.

## Route 3 — rules, docs, the harness

**Your case when:** agent behaviour must change («always», «never»), a rule or runbook is stale,
a helper role or a hook changes.

**Order:** edit the rule file (format `rules/README.md`); a new rule gets an `@rules/` import
line in `CLAUDE.md`, a removed one loses both; a hook or gate change is tested by running
`node tools/preflight.mjs` and `node tools/gate.mjs --self-test`; a decision behind a rule is a
record. Weakening an invariant is the owner's call, explained in plain language.

**Done when:** the next session's preflight is quiet and the rule reads correctly in
`CLAUDE.md`.

## Sync map (what every route updates)

| Changed | Update in the same pass |
|---|---|
| behaviour the players see | `product/spec.md`; `docs/for-owner/status.md` at release |
| a fork settled | `product/decisions/NNN`; the entry removed from `product/open-questions.md` |
| a technical design | `product/decisions/NNN`; the pull request names it |
| server, deploy, secrets | the runbook; `deploy/` files; `docs/for-owner/status.md` if live |
| agent behaviour | `rules/`, `CLAUDE.md` import line, this file if a route changed |
| any touched doc | the `Last verified: <date>` footer |
