# Backup and restore — the database is the players' balances

Every compose call goes through `sh deploy/compose.sh` (it points docker compose at
`deploy/docker-compose.yml` and the root `.env`; see `deploy.md`). On this server the login user
reaches Docker through its group, so a non-interactive command wraps the call in
`sg docker -c "…"`, and the redirection stays OUTSIDE that wrapper — otherwise the dump lands
inside the subshell's quoting and comes out empty.

## 1. A dump on demand (before and after a risky change)

```bash
ssh kiberpride 'cd /opt/ruslan-bot && mkdir -p backups && sg docker -c "sh deploy/compose.sh exec -T postgres pg_dump -U kiber -Fc kiberpride" > backups/$(date +%F_%H%M)_manual.dump && ls -la backups | tail -3'
```

## 2. The nightly job

Installed once by the agent as a cron line for the login user (`ruslan` on this server):

```
15 4 * * * cd /opt/ruslan-bot && sg docker -c "sh deploy/compose.sh exec -T postgres pg_dump -U kiber -Fc kiberpride" > backups/$(date +\%F)_nightly.dump && find backups -name "*_nightly.dump" -mtime +14 -delete
```

Weekly, the agent pulls the latest dump to the workstation:
`scp kiberpride:/opt/ruslan-bot/backups/<latest> backups-local/` (`backups-local/` is
ignored by git).

## 3. Restore

Into a scratch database first, to prove the dump is readable:

```bash
ssh kiberpride 'cd /opt/ruslan-bot && C="sh deploy/compose.sh exec -T postgres" && $C createdb -U kiber scratch && $C pg_restore -U kiber -d scratch < backups/<dump> && $C psql -U kiber -d scratch -c "select count(*) from \"KpTransaction\"" && $C dropdb -U kiber scratch'
```

Into the live database only for a real rollback: stop the bot (`sh deploy/compose.sh stop bot`),
`dropdb` + `createdb` + `pg_restore`, start the bot, read the signal (`deploy.md` §4).

## 4. The restore check

Done once after the first deploy and after every PostgreSQL upgrade; the date is written here:

- Last restore check: **2026-09-20** — the first dump (48 KB) was restored into a scratch
  database on the server, `ShopGood` counted 3 rows, and the scratch database was dropped.

---

Last verified: 2026-09-20 (walked on the owner's server after the first deploy: manual dump,
restore check, nightly cron installed; the `sg docker` wrapper added).
