# Deploy — shipping a version to the server and reading the signal

The agent is the pipeline (decision 001 §6). The server is the owner's existing shared host and
the bot lives in **`/opt/ruslan-bot`** (decision 019): a clone of the repository, `.env` at its
root, PostgreSQL data in a named volume, dumps in `/opt/ruslan-bot/backups`. Other services run
on that host — the Python KiberPride bot in `/opt/kiberpride-bot`, a VPN, two more units — and
nothing outside our folder and our Docker objects is touched. SSH is `ssh kiberpride` (the alias
in `~/.ssh/config`, key `~/.ssh/kiberpride-bot`); `docker` needs no sudo (the login user is in
the `docker` group). The compose file is `deploy/docker-compose.yml`; every compose
call goes through **`sh deploy/compose.sh …`**, which passes the root `.env` and bakes the git
short sha as `APP_VERSION` into the image.

## Secrets on the server

`/opt/ruslan-bot/.env` is written once by the agent over SSH (`ssh kiberpride 'cat >
/opt/ruslan-bot/.env' < .env.server`, where `.env.server` is a local ignored file), mode `600`.
**Write it with LF line endings and no BOM:** a file written by PowerShell carries both, and the
bot then does not see `DISCORD_TOKEN` (the first run needed
`sed -i '1s/^\xEF\xBB\xBF//'` and `tr -d '\r'` on the server to repair it). Names as in `.env.example`; on the server it needs `DISCORD_TOKEN`,
`POSTGRES_PASSWORD` and `LOG_LEVEL=info`.
`DATABASE_URL` is NOT needed there: `deploy/docker-compose.yml` builds it from
`POSTGRES_PASSWORD`. Because the password is spliced into that URL, generate it URL-safe:
`openssl rand -hex 32` (hex only; no `@ : / ? #` to break the URL). Postgres applies
`POSTGRES_PASSWORD` only when its data volume is first created: changing it later in `.env`
does nothing to the database — change it with `ALTER USER` inside the running database first,
then in `.env`, then restart. `DISCORD_GUILD_ID` stays empty while the bot is in exactly one server
(it serves the one it is in); set it to the REAL server's id only if the bot is ever in two.

## What the container does on start

`prisma migrate deploy` → `node dist/prisma/seed.js` (create-only defaults: settings row,
games, placeholder reward rules; never overwrites) → the bot. A migration therefore runs with
every rollout that carries one — hence the backup before (§Every later deploy, step 2).

## First deploy

```bash
ssh kiberpride 'git clone https://github.com/TrezorTop/kiberpride-bot.git /opt/ruslan-bot'
# .env per §Secrets
ssh kiberpride 'cd /opt/ruslan-bot && sh deploy/compose.sh up -d --build'
```

The host has 1.9 GB of RAM and a 2 GB swap file added for the build (decision 019 §3). The first
build takes several minutes; run it in the background and read the log rather than waiting on a
blocked shell.

## Every later deploy

1. Rollback named: the current commit on the server (`git -C /opt/ruslan-bot rev-parse
   --short HEAD`) is written into the report before anything changes.
2. Backup before if there is a migration (`runbooks/backup-restore.md` §1) — a new folder
   under `prisma/migrations/` since the running commit.
3. `ssh kiberpride 'cd /opt/ruslan-bot && git pull --ff-only && sh deploy/compose.sh up -d --build'`.
4. **The signal** (rule `bot-always-on` §5), all three, quoted in the report:
   - `sh deploy/compose.sh ps` → `bot` is `running (healthy)` (the health check asks the bot
     itself: connected to Discord and the database answers);
   - `sh deploy/compose.sh logs --since 2m bot` shows `ready` with the new version, then
     `serving guild`, and no error;
   - the Discord log channel `kp-логи` shows the heartbeat «✅ Бот запущен · версия X» — the
     same `heartbeat` line with the version is in the process log; ask the owner to glance
     only if both are missing.
   - A bot that fails its guild setup, or has no Discord connection for over 5 minutes, exits
     with code 1 on purpose and is restarted; its last log line ends with `exiting so the
     process is restarted clean`. A restart loop with that line is the thing to read first.
5. Backup after if there was a migration.
6. `docs/for-owner/status.md`: what is live now, one dated line at the top.

## Rollback

`ssh kiberpride 'cd /opt/ruslan-bot && git checkout <previous> && sh deploy/compose.sh up -d
--build'`; if a migration must be undone, restore the «before» dump (`backup-restore.md` §3).
Tell the owner in one sentence.

## Reading the live state at any time

`sh deploy/compose.sh ps`, `sh deploy/compose.sh logs --tail 200 bot`, `docker stats
--no-stream`, `df -h /`. Reconnaissance is free and needs nobody's permission.

---

Last verified: 2026-09-20. Walked for the first deploy to the owner's server (decision 019):
clone into `/opt/ruslan-bot`, `.env` over SSH (BOM and CRLF had to be stripped), 2 GB swap added,
`ruslan` put in the `docker` group, `sh deploy/compose.sh up -d --build` — the image built in
about six minutes, both containers came up healthy, and the bot logged `ready`, `serving guild`,
six slash commands, `heartbeat` and `recovery done`.
