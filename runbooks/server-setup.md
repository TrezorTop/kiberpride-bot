# Server setup — choosing, buying, keying, hardening one small VPS

> **This runbook was NOT used.** The owner already had a server, and the bot was put on it at
> `/opt/ruslan-bot` next to their other services (decision 019). §4's hardening is deliberately
> not applied there: the host carries the owner's Python bot, a VPN and two more units, and a
> mistake in sshd or the firewall would take those down too. What was actually done is in
> `runbooks/deploy.md`; keep this file for the day a server of our own is bought.

Constraints from decision 001 §5: **outside Russia** (Discord is blocked inside), **paid in
rubles**, SSH key set at creation. Everything after the purchase is the agent over SSH.

## 1. Choosing (agent → owner as options)

Verify live at purchase time — prices and locations move. Open the provider's page and read the
current offer before presenting. Shortlist: Timeweb Cloud (locations NL / PL / DE; ruble cards),
Aeza (several EU locations; ruble payment). Target: 1–2 vCPU, 2 GB RAM, 20 GB SSD, Ubuntu 24.04
LTS. Present to the owner as two or three options: monthly price, where the server stands, one
sentence why (rule `plain-language` §4). Money is the owner's stop condition.

## 2. The SSH key (agent, on the workstation)

```bash
ssh-keygen -t ed25519 -C "kiberpride-bot" -f ~/.ssh/kiberpride-bot -N ""
```

The public half is `~/.ssh/kiberpride-bot.pub`. Put it on the clipboard for the owner:

```bash
cat ~/.ssh/kiberpride-bot.pub | clip
```

**OWNER:** at server creation, in the panel's «SSH key» field, paste (Ctrl+V) and continue.
Say: «в поле для ключа нажми Ctrl+V — я уже скопировал что нужно». If the provider has no key
field at creation, it emails a root password: the owner pastes it into a file the agent opens
(`notepad deploy/inventory.local`), the agent uses it once with `ssh-copy-id`, then disables
password login (§4). The password is never typed into chat.

Record the server's address and user in `deploy/inventory.local` (ignored by git):

```
HOST=<ip or hostname>
USER=root      # until §4 creates the bot user
KEY=~/.ssh/kiberpride-bot
```

## 3. First login

```bash
ssh -i ~/.ssh/kiberpride-bot -o StrictHostKeyChecking=accept-new root@<HOST> 'uname -a && df -h / && free -m'
```

Add to `~/.ssh/config` a `Host kiberpride` block (HostName, User, IdentityFile) so every later
command is `ssh kiberpride ...`.

## 4. Hardening (agent)

In ONE session that is kept open until a second session succeeds (rule `server-safety` §2):

1. `apt update && apt -y upgrade`, `apt -y install ufw fail2ban unattended-upgrades`.
2. A user for the bot: `adduser --disabled-password --gecos "" kiber && usermod -aG sudo kiber`,
   copy `/root/.ssh/authorized_keys` to `/home/kiber/.ssh/` with the right owner and modes,
   `echo 'kiber ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/kiber`.
3. `/etc/ssh/sshd_config.d/hardening.conf`: `PasswordAuthentication no`, `PermitRootLogin no`,
   `PubkeyAuthentication yes`. `sshd -t && systemctl reload ssh`.
4. **Second session** as `kiber` must succeed BEFORE the first is closed. Then `USER=kiber` in
   `inventory.local` and in `~/.ssh/config`.
5. Firewall: `ufw default deny incoming && ufw default allow outgoing && ufw allow OpenSSH &&
   ufw --force enable`. The bot needs no inbound port — it talks out to Discord.
6. Docker: the official convenience script (`curl -fsSL https://get.docker.com | sh`),
   `usermod -aG docker kiber`. Verify `docker run --rm hello-world` as `kiber`.
7. Timezone `timedatectl set-timezone Europe/Moscow` (the players' time for logs and dumps).

## 5. The way back in

Note in `deploy/inventory.local` where the provider's web console / rescue mode is (the panel
page). This is the owner's fallback if the key is ever lost; the agent walks them through it in
chat if it comes to that.

## 6. Verify

`ssh kiberpride 'docker --version && ufw status && grep -r PasswordAuthentication
/etc/ssh/sshd_config.d/'` — Docker present, ufw active with only OpenSSH, password auth `no`.
Then `runbooks/deploy.md`.

---

Last verified: 2026-09-19 (written; the first server updates it).
