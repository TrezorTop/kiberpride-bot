---
id: no-secrets-in-git
tier: invariant
---

# No secret value in git, in chat, in logs, in a doc

**Digest:** The bot token, the database password, an SSH private key, a hosting API key — never
committed, never pasted into chat, never printed in a log or a doc. Secrets live in `.env` locally
(ignored by git) and in the server's environment; docs and rules name WHERE a secret lives, never
its value. The repository is public: assume everything in it is read by strangers.

1. **Locations, not values.** `.env` on the workstation (in `.gitignore` from the first commit),
   `/opt/ruslan-bot/.env` on the server, the SSH private key in the owner's user profile. A
   doc says «the token is in `.env`», never the token. `.env.example` carries the variable NAMES
   with empty or fake values.
2. **The owner never pastes a secret into chat.** When a secret must reach the agent (the Discord
   token), the agent opens `.env` for the owner in Notepad with a ready line to complete, or asks
   them to paste it into that file. If a secret lands in chat anyway, it is treated as leaked: the
   agent says so in one calm sentence and regenerates it (a Discord token is reset in the
   developer portal in ten seconds).
3. **Logs and the Discord log channel** carry ids, names and amounts, never tokens or passwords.
   A stack trace is scrubbed before it is posted anywhere.
4. **The repository is public** (owner's decision 2026-09-19). Server addresses, the owner's
   personal data and player data therefore do not belong in it either: a runbook says «the
   server's address is in `deploy/inventory.local` (ignored)», not the address.
5. **Before every commit** the builder checks the diff for a token-shaped string, an `.env`, a
   private key, a dump of the database. The gate in `tools/gate.mjs` refuses `git add` of `.env*`
   and key files; it is a seatbelt, not a substitute for looking.
6. **Rotation is a routine, not a crisis:** Discord token → developer portal → new value into both
   `.env` files → restart; recorded in `runbooks/discord-app-setup.md`.

**Why:** a leaked bot token lets a stranger act as the bot on the owner's server — delete
channels, spam players, drain the economy — within minutes, and public repositories are scanned
for tokens continuously. The owner cannot judge what is secret and what is not, so the boundary
is drawn by the agent, once, and enforced by habit and by the gate.
