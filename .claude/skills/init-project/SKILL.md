---
name: init-project
description: Turn the empty kiberpride-bot repository into a running bot on the owner's machine — toolchain, Discord application, project scaffold, first green gate, first pull request. The whole first session. Use when there is no src/ yet or the owner says «начинаем» / «/init-project».
---

# /init-project — from an empty repository to a bot that answers on the test server

You are the lead. The owner is watching the chat and is not technical: every message to them is
Russian, on «ты», product level (rule `plain-language`). Everything below is yours except the
three **OWNER** moments, each reduced to one screen.

Say at the start, in two sentences: what will happen and that you will ask for three small
things along the way. Then work; report progress in one line per completed stage.

## Stage 1 — the workstation

`runbooks/workstation-setup.md` §1–§3. Install what is missing with `winget`. If Docker Desktop
needs a reboot, say so in one sentence and stop the session cleanly with a note in
`docs/for-owner/status.md` («после перезагрузки снова напиши /init-project») — the next run
resumes here because the stages are idempotent.

## Stage 2 — the Discord application (OWNER ×2)

`runbooks/discord-app-setup.md` §1–§2: the application and the token into `.env` (via
`notepad .env`; never chat). Then §4: the test server (ask now, before the code, so the first
run has somewhere to go). Skip §3 until the scaffold exists.

## Stage 3 — the scaffold (architect first, then builder)

1. Delegate to the **architect** (`subagent_type: architect`, no `model`): «Rule the module
   layout, the database schema for the first release and the match state machine, within
   decision 001. Return three decision records in the README's shape.» File them as
   `product/decisions/002…004`. This is the one place where the first session takes design
   decisions; nothing is scaffolded before they are written.
2. Delegate to the **builder**: scaffold per the records — `package.json` with scripts `dev`,
   `build`, `check` (typecheck + lint + test), `migrate:deploy`, `invite-link`; TypeScript
   strict; discord.js v14; Prisma with the ruled schema and a first migration; pino; Vitest;
   ESLint + Prettier; `deploy/docker-compose.yml` (bot + postgres, health checks, `restart:
   unless-stopped`) and `docker-compose.dev.yml` (local and test databases); `Dockerfile`; `deploy/` per `runbooks/deploy.md`; `.env.example` with
   every variable name; a `src/<module>/README.md` per module (five lines: what it owns, its
   service interface, its extension point); a GitHub Actions workflow running `npm run check`
   on pull requests. First functionality: the bot logs in, registers `/баланс` and `/профиль`
   for the test guild, posts the heartbeat to a log channel it creates if missing, and
   `npm run check` is green with at least one real test (the KP transaction idempotency).
3. `runbooks/discord-app-setup.md` §3: the invite link (**OWNER** clicks it once and picks the
   test server). Start the bot locally (`npm run db:up`, `npx prisma migrate deploy`,
   `npm run db:seed`, `npm run dev`); use
   `/баланс` yourself is impossible — ask the owner to press it once on the test server and
   confirm they saw «💰 0 KP». That confirmation is the first product moment; make it visible.

## Stage 4 — the first pull request

Rule `github-flow`: branch `init/scaffold`, commits without attribution lines, push (the
**OWNER** signs in to GitHub in the window that opens — `runbooks/workstation-setup.md` §4),
«refute this» to a fresh architect, fixes, `gh pr create`, merge, delete the branch,
fast-forward `main`.

## Stage 5 — doc-sync and the next step

- `docs/for-owner/status.md` (Russian): what the bot can do now, dated.
- Footers `Last verified` on the runbooks that were actually walked, with any step that
  differed corrected.
- `product/open-questions.md`: remove Q7 (test server) with a decision record if the owner
  answered.
- Tell the owner in three sentences what works, and that the next thing is the economy (shop,
  history) unless they want a different order — the order of features is theirs.

## Done when

The bot answers `/баланс` on the test server; `npm run check` is green; `main` holds the merged
scaffold; `status.md` exists; the owner has had one visible product moment and no technical
question they could not answer in one click.
