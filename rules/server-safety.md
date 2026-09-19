---
id: server-safety
tier: practice
---

# The server: key-only access, a backup before a risky change, never lock the owner out

**Digest:** The agent operates the server itself over SSH with a key it generated; password login
is disabled and never turned back on. Before any change that can lose data (database migration,
upgrade, moving files) — a backup, then the change, then a backup and a read-only check. The
owner keeps a way back in (the provider's console) and is told, in one sentence, what was changed
on the server and how it is undone.

1. **Access is by key only.** The agent generates the key pair on the owner's workstation
   (`runbooks/server-setup.md`), the public half is pasted by the owner into the hosting panel
   at server creation, the private half never leaves their user profile and is never printed.
   `PasswordAuthentication no` after the first login; a non-root user for the bot; a firewall
   that opens only SSH.
2. **A way back in.** The hosting provider's web console (or a rescue mode) is the owner's fallback
   if the key is lost; the runbook records where it is. A change that could break SSH (sshd
   config, firewall) is tested in a second session before the first is closed.
3. **Backup before, backup after.** The database (`pg_dump`) before any migration or upgrade;
   the same after; a restore of the «before» dump into a scratch database at least once after
   the first deploy, so the procedure is known to work (`runbooks/backup-restore.md`). A nightly
   dump kept for 14 days on the server plus one copy pulled to the workstation weekly.
4. **A narrow, reversible change.** One thing at a time; the rollback named before the change is
   made (the previous image tag, the previous dump). Two changes in one rollout are two rollouts.
5. **Location matters.** Discord is blocked inside Russia, so the server is placed OUTSIDE Russia
   with a provider the owner can pay in rubles; the shortlist and the reasoning live in decision
   `product/decisions/001-stack-and-hosting-shape.md` and `runbooks/server-setup.md`.
6. **Report in product terms** (rule `plain-language`): «бот обновлён, всё на месте, откат за
   минуту если что» — the commands and paths stay in the runbook.

**Why:** the server is the one place where a mistake is not undone by `git checkout`: a lost
database is the players' balances and the match history, and a broken SSH is a server nobody can
reach. Key-only access and the backup ritual cost minutes and are the only insurance available on
a single small server. Carried over from the previous project's fleet rules, cut down to one host.
