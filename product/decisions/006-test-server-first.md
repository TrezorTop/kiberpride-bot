# 006. A private test server first; the real KiberPride server only at go-live

**Status:** accepted
**Date:** 2026-09-19
**Decided by:** owner (product)

## Context
Open question Q7: should every check run on a private test Discord server before anything
reaches the real KiberPride server? At `/init-project` the owner invited the bot to their own
test server and said the finished bot goes to the main server later, with the agent's help.

## Decision
1. All development and checks run on the owner's test server.
2. The bot is invited to the real KiberPride server only when the owner explicitly asks for
   go-live; the agent then prepares the invite link and the one-click steps.

## Rejected
- **Developing directly on the real server** — players would see half-built features and test
  KP movements.

## Consequences
The go-live needs a second invite and, if the server id is not the only guild, `DISCORD_GUILD_ID`
set explicitly (the bot refuses to guess between two guilds). Settings (channels, roles, reward
amounts) are configured anew on the real server at go-live.
