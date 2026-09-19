# Backup and restore — the database is the players' balances

## 1. A dump on demand (before and after a risky change)

```bash
ssh kiberpride 'cd /opt/kiberpride-bot && mkdir -p backups && docker compose exec -T postgres pg_dump -U kiber -Fc kiberpride > backups/$(date +%F_%H%M)_manual.dump && ls -la backups | tail -3'
```

## 2. The nightly job

Installed once by the agent as a cron line for `kiber`:

```
15 4 * * * cd /opt/kiberpride-bot && docker compose exec -T postgres pg_dump -U kiber -Fc kiberpride > backups/$(date +\%F)_nightly.dump && find backups -name '*_nightly.dump' -mtime +14 -delete
```

Weekly, the agent pulls the latest dump to the workstation:
`scp kiberpride:/opt/kiberpride-bot/backups/<latest> backups-local/` (`backups-local/` is
ignored by git).

## 3. Restore

Into a scratch database first, to prove the dump is readable:

```bash
ssh kiberpride 'cd /opt/kiberpride-bot && docker compose exec -T postgres createdb -U kiber scratch && docker compose exec -T postgres pg_restore -U kiber -d scratch < backups/<dump> && docker compose exec -T postgres psql -U kiber -d scratch -c "select count(*) from \"Transaction\"" && docker compose exec -T postgres dropdb -U kiber scratch'
```

Into the live database only for a real rollback: stop the bot (`docker compose stop bot`),
`dropdb` + `createdb` + `pg_restore`, start the bot, read the signal (`deploy.md` §4).

## 4. The restore check

Done once after the first deploy and after every PostgreSQL upgrade; the date is written here:

- Last restore check: **not yet** (the first deploy does it).

---

Last verified: 2026-09-19 (written; the first deploy updates it).
