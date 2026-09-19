# 005. Currency display — every amount is shown with the full name «KP Coin»

**Status:** accepted
**Date:** 2026-09-19
**Decided by:** owner (product)

## Context
The brief named the currency `KP Coin` with the short form `KP` for amounts (`💰 1 250 KP`).
After the first `/баланс` on the test server showed «💰 0 KP», the owner asked for «KP Coin».
Three readings were offered: the full name in every amount, only in the footer, or in headings
with `KP` in amounts.

## Decision
Every amount players see carries the full name: `💰 1 250 KP Coin`, `+100 KP Coin — победа в
CS2`, `-500 KP Coin — доступ к GIF`, and player text that names the currency says «KP Coin».
One constant (`CURRENCY` in `src/discord/views/format.ts`) holds the name.

## Rejected
- **Full name only in the footer, `KP` in amounts** — not what the owner chose.
- **Full name in headings, `KP` in amounts and history** (the agent's recommendation, for
  shorter history lines) — the owner preferred the name to be the same everywhere.

## Consequences
History lines get a little longer; the profile's last-five list stays readable. Internal names
(code, ledger kinds, docs) keep `KP`; only player-facing text changes.
