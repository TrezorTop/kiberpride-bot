---
id: bot-always-on
tier: invariant
---

# The bot survives restarts, and a breakage is learned from a signal, not from a player

**Digest:** Every active recruitment and match lives in the database, not in memory, and is
restored after a restart with its buttons working. Every money movement is one transaction row
that cannot be applied twice. A change rolled to the server is followed by a live signal (the
bot's heartbeat in the log channel, a health check, the server's process state); «the container
came up» is not a signal. No signal — create one, or record a dated gap.

1. **State is in the database.** Recruitments, sign-ups, teams, match status, rewards — never only
   in a variable or a message. On start the bot re-attaches to every open recruitment message and
   rebuilds its buttons; a button pressed after a restart still works.
2. **Money is idempotent.** Rewarding a match, buying an item, any KP change is a transaction row
   with a unique reference; applying the same reference twice is a no-op, and a match cannot be
   finished twice. Concurrent presses of the same button (ten players clicking «join» at once)
   are serialised in the database, not in code.
3. **Every important action is logged twice:** to the process log and to the Discord log channel
   (purchases, rewards, match lifecycle, team changes, admin actions, errors). Logs carry ids and
   amounts, never secrets.
4. **A heartbeat the owner never sees:** the bot posts a quiet «alive» to the log channel on
   start and reports in it when it fails to reconnect; the server restarts the process on crash
   (`restart: unless-stopped` and a health check in `deploy/`).
5. **After every rollout** the agent reads the signal (the log channel's «alive» with the new
   version, the health check, `docker compose ps`) and quotes it in the report. If a rollout cannot
   be observed, the gap is written into the runbook with a date and the next step to close it.
6. **Failure is honest to the player:** an error message says what to do next in plain words;
   the details go to the log channel, not to the player.
7. **Leaving players are handled:** a player who leaves the Discord server is removed from open
   recruitments and their pending rewards are settled by the rule in `product/spec.md`.

**Why:** a recruitment that dies with a restart, or a reward paid twice, is the fastest way to
lose the players' trust in the economy — and the owner learns about it from an angry player, the
worst possible sensor. Restart-safety and idempotent money were the two explicit demands of the
original brief; the observability duty comes from the previous project, where «the container is
up» hid three silent outages.
