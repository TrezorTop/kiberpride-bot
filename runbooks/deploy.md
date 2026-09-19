# Deploy — shipping a version to the server and reading the signal

The agent is the pipeline (decision 001 §6). Layout on the server: `/opt/kiberpride-bot` (a
clone of the repository), `.env` at its root, PostgreSQL data in a named volume, dumps in
`/opt/kiberpride-bot/backups`. The compose file is `deploy/docker-compose.yml`; every compose
call goes through **`sh deploy/compose.sh …`**, which passes the root `.env` and bakes the git
short sha as `APP_VERSION` into the image.

## Secrets on the server

`/opt/kiberpride-bot/.env` is written once by the agent over SSH (`ssh kiberpride 'cat >
/opt/kiberpride-bot/.env' < .env.server`, where `.env.server` is a local ignored file), mode
`600`, owner `kiber`. Names as in `.env.example`; on the server it needs `DISCORD_TOKEN`,
`POSTGRES_PASSWORD` (a long random string the agent generates) and `LOG_LEVEL=info`.
`DATABASE_URL` is NOT needed there: `deploy/docker-compose.yml` builds it from
`POSTGRES_PASSWORD`. `DISCORD_GUILD_ID` stays empty while the bot is in exactly one server
(it serves the one it is in); set it to the REAL server's id only if the bot is ever in two.

## What the container does on start

`prisma migrate deploy` → `node dist/prisma/seed.js` (create-only defaults: settings row,
games, placeholder reward rules; never overwrites) → the bot. A migration therefore runs with
every rollout that carries one — hence the backup before (§Every later deploy, step 2).

## First deploy

```bash
ssh kiberpride 'sudo mkdir -p /opt/kiberpride-bot && sudo chown kiber: /opt/kiberpride-bot && git clone https://github.com/<owner>/kiberpride-bot.git /opt/kiberpride-bot'
# .env per §Secrets
ssh kiberpride 'cd /opt/kiberpride-bot && sh deploy/compose.sh up -d --build'
```

## Every later deploy

1. Rollback named: the current commit on the server (`git -C /opt/kiberpride-bot rev-parse
   --short HEAD`) is written into the report before anything changes.
2. Backup before if there is a migration (`runbooks/backup-restore.md` §1) — a new folder
   under `prisma/migrations/` since the running commit.
3. `ssh kiberpride 'cd /opt/kiberpride-bot && git pull --ff-only && sh deploy/compose.sh up -d --build'`.
4. **The signal** (rule `bot-always-on` §5), all three, quoted in the report:
   - `sh deploy/compose.sh ps` → `bot` is `running (healthy)` (the health check asks the bot
     itself: connected to Discord and the database answers);
   - `sh deploy/compose.sh logs --since 2m bot` shows `ready` with the new version, then
     `serving guild`, and no error;
   - the Discord log channel `kp-логи` shows the heartbeat «✅ Бот запущен · версия X» — the
     same `heartbeat` line with the version is in the process log; ask the owner to glance
     only if both are missing.
5. Backup after if there was a migration.
6. `docs/for-owner/status.md`: what is live now, one dated line at the top.

## Rollback

`ssh kiberpride 'cd /opt/kiberpride-bot && git checkout <previous> && sh deploy/compose.sh up -d
--build'`; if a migration must be undone, restore the «before» dump (`backup-restore.md` §3).
Tell the owner in one sentence.

## Reading the live state at any time

`sh deploy/compose.sh ps`, `sh deploy/compose.sh logs --tail 200 bot`, `docker stats
--no-stream`, `df -h /`. Reconnaissance is free and needs nobody's permission.

---

Last verified: 2026-09-19 (aligned with `deploy/` and the Dockerfile as scaffolded; not yet run
on a server — the first deploy updates it).
