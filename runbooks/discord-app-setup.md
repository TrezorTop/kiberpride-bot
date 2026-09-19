# Discord application setup — the bot's identity, its token, the test server

The Discord developer portal is the owner's account: the agent cannot create the application or
copy the token. Everything else is the agent's. Each OWNER step is one screen; say what to do
in one or two Russian sentences and wait.

## 1. The application (OWNER, ~2 minutes)

1. Open https://discord.com/developers/applications → «New Application» → name `KiberPride Bot`
   → Create.
2. Left menu «Bot» → «Reset Token» → copy the token (shown once).
3. Same page, «Privileged Gateway Intents»: turn on **Server Members Intent** (needed to handle a
   player leaving the server). Message Content is NOT needed — everything is slash commands and
   buttons.

## 2. The token into `.env` (never into chat)

The agent runs `notepad .env` (creating it from `.env.example` first) and asks the owner to
paste the token after `DISCORD_TOKEN=` and save. Then the agent reads the file's SHAPE only
(`grep -c '^DISCORD_TOKEN=.\{50,\}' .env` → `1`), never prints the value.

If the owner pasted the token into chat: one calm sentence, then step 1.2 again (Reset Token)
and this step again. The old token is dead the moment it is reset.

Also into `.env`: `DISCORD_CLIENT_ID` (the «Application ID» on the General Information page —
not secret, but keep it with the rest), `DISCORD_GUILD_ID` (the test server's id; see §4).

## 3. The invite link (agent)

`https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=<PERMISSIONS>`

`<PERMISSIONS>` is computed by the agent from what the bot needs: Manage Roles, Manage
Channels, Move Members, View Channels, Send Messages, Embed Links, Read Message History, Connect.
The permission integer is printed by `npm run invite-link` once the project exists (a tiny
script `/init-project` creates). The bot's role must sit ABOVE the roles it will grant (image
access, GIF access) in the server's role list — the agent checks this at first start and says
in plain words if the owner must drag the bot's role up.

## 4. The test server (OWNER, ~1 minute)

«Создай пустой сервер в Discord (плюсик слева, «Создать свой»), назови как хочешь, например
KiberPride Test». Then the owner opens the invite link from §3 and picks that server. The agent
gets the server id from the bot itself on start (the guild the bot sees) — the owner is not asked
to enable developer mode or copy ids.

Everything is tested there. The real KiberPride server gets the bot only at the go-live the
owner explicitly asks for (Route 1 stop condition).

## 5. Token rotation

Developer portal → Bot → Reset Token → new value into the workstation `.env` (§2) and into the
server's `.env` over SSH (`runbooks/deploy.md` §Secrets) → `docker compose up -d bot` → the
heartbeat in the log channel confirms.

---

Last verified: 2026-09-19 (written; the first run updates it).
