# KiberPride Bot — boot context

This repository is the Discord bot of the KiberPride gaming server: a **KP Coin economy** (balance,
shop, transaction history) and **game recruitment and matches** (sign-up, automatic or manual
teams, voice channels, winner, MVP, rewards). One repository holds everything: the product canon,
the agent rules, the code, the deployment. Stage: **pre-code** until `/init-project` has run.

## Who you work with

**The owner is a product person, not an engineer.** They open Claude Code on their Windows machine
in bypass-permissions mode and talk to you in plain Russian about what the bot should do. **You do
all of the technical work yourself**: the toolchain, the code, tests, git, GitHub, the Discord
application, the server, deployment, backups, monitoring. The owner is asked only for **product
decisions** and for the few actions only a human account can perform (creating the Discord
application, pasting a key into a hosting panel, paying). Rules `owner-is-product` and
`plain-language` below are the contract; read them before your first reply.

## The order of any work

Product canon first, then code. `product/spec.md` is what the bot is; `product/open-questions.md`
is what is not yet decided; `product/decisions/` is why things are the way they are. A task's route
is in [FLOW.md](FLOW.md) — read the route before the first edit. A decision is written into a
decision record BEFORE the code, the closed step is reviewed by the architect with «refute this»
BEFORE the merge, and every change ends by updating the affected docs in the same pass.

## Where things are

| Where | What |
|---|---|
| [product/spec.md](product/spec.md) | the product canon: what the bot does, in the owner's terms |
| [product/open-questions.md](product/open-questions.md) | product forks not yet settled with the owner, with plain-language options |
| [product/decisions/](product/decisions/README.md) | decision records: the stack, the hosting shape, every design ruling |
| [rules/](rules/README.md) | the rules, one file each; all are imported below |
| [FLOW.md](FLOW.md) | routes: product feature / infrastructure / rules and docs; stop conditions; «done» |
| [runbooks/](runbooks/README.md) | step-by-step procedures: workstation, Discord application, server, deploy, backup |
| [docs/for-owner/](docs/for-owner/) | texts the OWNER reads, in Russian: first run, what the bot can do now |
| `.claude/agents/` | the helper roles (architect, builder, explorer, prober) with their models |
| `.claude/skills/init-project/` | the `/init-project` route that turns this empty repo into a running bot |
| `tools/` | `preflight.mjs` (session start), `gate.mjs` (tool-call gate) |
| `src/`, `prisma/`, `deploy/` | the code, the schema, the deployment — created by `/init-project` |

## Rules

Every rule is imported in full; the digest is the first paragraph of each file.

@rules/owner-is-product.md
@rules/plain-language.md
@rules/opus-decides-design.md
@rules/model-roles.md
@rules/work-order-and-doc-sync.md
@rules/no-secrets-in-git.md
@rules/github-flow.md
@rules/bot-always-on.md
@rules/server-safety.md
@rules/edit-with-tools.md

## Product canon and open questions

@product/spec.md
@product/open-questions.md

## Session start

`tools/preflight.mjs` runs on every session start (hook in `.claude/settings.json`): fetches
`origin`, reports a lagging `main`, uncommitted work, a missing toolchain, the count of open product
questions. Quiet when everything is fine; one Russian line at the top of the first answer when it
is not. If Node.js is missing the hook says so — installing it is the first step of
`runbooks/workstation-setup.md`.
