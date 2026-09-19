# Deploy — shipping a version to the server and reading the signal

The agent is the pipeline (decision 001 §6). Layout on the server: `/opt/kiberpride-bot` (a
clone of the repository), `.env` next to `docker-compose.yml`, PostgreSQL data in a named
volume, dumps in `/opt/kiberpride-bot/backups`.

## Secrets on the server

`/opt/kiberpride-bot/.env` is written once by the agent over SSH (`ssh kiberpride 'cat >
/opt/kiberpride-bot/.env' < .env.server`, where `.env.server` is a local ignored file), mode
`600`, owner `kiber`. Values are the same names as `.env.example`; `DISCORD_GUILD_ID` is the
REAL server's id after go-live, the test server's before.

## First deploy

```bash
ssh kiberpride 'sudo mkdir -p /opt/kiberpride-bot && sudo chown kiber: /opt/kiberpride-bot && git clone https://github.com/<owner>/kiberpride-bot.git /opt/kiberpride-bot'
# .env per §Secrets
ssh kiberpride 'cd /opt/kiberpride-bot && docker compose up -d --build'
ssh kiberpride 'cd /opt/kiberpride-bot && docker compose exec bot npm run migrate:deploy'
```

## Every later deploy

1. Rollback named: the current commit on the server (`git -C /opt/kiberpride-bot rev-parse
   --short HEAD`) is written into the report before anything changes.
2. Backup before if there is a migration (`runbooks/backup-restore.md` §1).
3. `ssh kiberpride 'cd /opt/kiberpride-bot && git pull --ff-only && docker compose up -d --build
   && docker compose exec bot npm run migrate:deploy'`.
4. **The signal** (rule `bot-always-on` §5), all three, quoted in the report:
   - `docker compose ps` → `bot` is `running (healthy)`;
   - `docker compose logs --since 2m bot` shows `ready` with the new version and no error;
   - the Discord log channel shows the heartbeat «🟢 бот запущен, версия X» — read it via the
     bot's own log or ask the owner to glance only if the log line is missing.
5. Backup after if there was a migration.
6. `docs/for-owner/status.md`: what is live now, one dated line at the top.

## Rollback

`ssh kiberpride 'cd /opt/kiberpride-bot && git checkout <previous> && docker compose up -d
--build'`; if a migration must be undone, restore the «before» dump (`backup-restore.md` §3).
Tell the owner in one sentence.

## Reading the live state at any time

`docker compose ps`, `docker compose logs --tail 200 bot`, `docker stats --no-stream`,
`df -h /`. Reconnaissance is free and needs nobody's permission.

---

Last verified: 2026-09-19 (written; the first deploy updates it).
