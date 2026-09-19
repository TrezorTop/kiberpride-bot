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

Nothing else is asked of the owner. `DISCORD_CLIENT_ID` stays empty: the application id is the
first segment of the token (`src/discord/invite.ts`). `DISCORD_GUILD_ID` stays empty: the bot
serves the one server it is in (see §4); it is set only if the bot is ever in several servers.

## 3. The invite link (agent)

`https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=<PERMISSIONS>`

`<PERMISSIONS>` is what the bot needs: Manage Roles, Manage Channels, Move Members, View
Channels, Send Messages, Embed Links, Read Message History, Connect = `286346256`.
`npm run invite-link` prints the whole URL (application id derived from the token in `.env`;
it prints only the URL, never the token). The bot's role must sit ABOVE the roles it will grant (image
access, GIF access) in the server's role list — the agent checks this at first start and says
in plain words if the owner must drag the bot's role up.

## 4. The test server (OWNER, ~1 minute)

«Создай пустой сервер в Discord (плюсик слева, «Создать свой»), назови как хочешь, например
KiberPride Test». Then the owner opens the invite link from §3 and picks that server. The agent
gets the server id from the bot itself on start (the guild the bot sees) — the owner is not asked
to enable developer mode or copy ids. The process log says which: `serving guild` (with its
name), `bot is in no guild yet — open the invite link` (it keeps running and picks the server up
the moment it is invited), or `bot is in several guilds and DISCORD_GUILD_ID is not set`
(it serves none until the id is set). On first serving it creates the admin-only text channel
`kp-логи`, stores its id, and posts «✅ Бот запущен · версия X» there.

Everything is tested there. The real KiberPride server gets the bot only at the go-live the
owner explicitly asks for (Route 1 stop condition).

## 5. Token rotation

Developer portal → Bot → Reset Token → new value into the workstation `.env` (§2) and into the
server's `.env` over SSH (`runbooks/deploy.md` §Secrets) → `sh deploy/compose.sh up -d bot` → the
heartbeat in the log channel confirms.

---

Last verified: 2026-09-19 (§2–§4 aligned with the scaffold: optional ids, `npm run
invite-link` checked against the real `.env`; the bot's first start on the test server updates it).
