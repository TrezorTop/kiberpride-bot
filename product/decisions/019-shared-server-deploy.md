# 019. The bot runs in `/opt/ruslan-bot` on the owner's existing shared server, next to other services

**Status:** accepted (amends 001 §5–§6 and the server runbooks)
**Date:** 2026-09-20
**Decided by:** owner (the server and the path) and architect (how to be a good neighbour on it)

## Context
Decision 001 assumed a fresh VPS bought for this bot, hardened by the agent, at
`/opt/kiberpride-bot`. The owner already has a server and asked to put the bot there, at
**`/opt/ruslan-bot`**, «в рамках нашей папки бота».

What is already on it (Ubuntu, kernel 6.8, 1.9 GB RAM, 39 GB disk, Moscow-time host, Docker 29,
git 2.43):
- `kiberpride-bot.service` — the owner's earlier Python bot in `/opt/kiberpride-bot`, running as
  its own user, with its own Discord token;
- `bitrixbot.service`, `gearup.service`;
- Amnezia VPN containers (`amnezia-awg2`, `amnezia-openvpn`);
- the login user `ruslan`, with `sudo` by password.

Q6 (hosting budget) is therefore closed without spending anything.

## Decision
1. **Location:** `/opt/ruslan-bot`, a clone of the public repository, owned by `ruslan`. Nothing
   outside that folder, the bot's own Docker objects and the two changes in §3 is touched.
2. **Isolation from the neighbours:**
   - Compose project `kiberpride-bot` with its own network and its own `pgdata` volume;
   - **no published ports** — the database is reachable only from the bot's container, and the
     bot only talks out to Discord;
   - image name and container names carry the project prefix, so nothing collides with the
     Python bot or the VPN containers;
   - log rotation stays as in `deploy/docker-compose.yml` (10 MB × 5) so the disk cannot fill.
3. **Changes made to the host, both narrow and reversible:**
   - `ruslan` added to the `docker` group, so deploys need no password prompt;
   - a 2 GB swap file (`/swapfile`, in `/etc/fstab`), because 1.9 GB of RAM is not enough to
     build the image and run Postgres comfortably. Undo: `swapoff /swapfile`, remove the fstab
     line, delete the file.
4. **The hardening of `runbooks/server-setup.md` §4 is NOT applied** on this server: no
   `PasswordAuthentication no`, no `ufw`, no new user, no sshd change. The machine carries the
   owner's other services and their access; a lockout would take those down with us, and this
   agent did not set them up. The agent's own access is a key it generated
   (`~/.ssh/kiberpride-bot`, host alias `kiberpride`); the owner's password login stays as it
   was.
5. **Secrets:** `/opt/ruslan-bot/.env`, mode 600, written over SSH from the workstation, never in
   git. It carries `DISCORD_TOKEN`, `POSTGRES_PASSWORD` (32 random bytes as hex), `LOG_LEVEL` and
   `NODE_ENV=production`. `DATABASE_URL` is built by compose.
6. **The token is the same application as the test bot,** so the bot may run in exactly one place
   at a time. When the server runs it, the workstation's `npm run dev` must be stopped, and the
   other way round. A second instance would answer every button twice.
7. **Backups** (`runbooks/backup-restore.md`) point at `/opt/ruslan-bot/backups`.

## Rejected
- **Buying a separate VPS** (001 §5). The owner has a server that already reaches Discord, and
  paying twice for a bot with a handful of players is waste.
- **Hardening this host as the runbook describes.** See §4.
- **`/opt/kiberpride-bot`.** Taken by the owner's Python bot; using it would have mixed two
  products in one folder.
- **A systemd unit like the neighbours'.** Compose with `restart: unless-stopped` plus the health
  check already restarts the bot, and Docker starts with the host.

## Consequences
- Watch memory: the host has 1.9 GB and now 2 GB of swap; the bot plus Postgres should sit near
  300–400 MB. If the Python bot, the VPN and this bot together start swapping badly, the next
  step is a separate server after all.
- The two bots share nothing; the new bot does not read the old bot's data. Moving the players'
  balances from the Python bot, if the owner ever wants it, is a separate piece of work.
- Every runbook path changes from `/opt/kiberpride-bot` to `/opt/ruslan-bot`.
