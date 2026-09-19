# 012. One look: every player-facing message is an embed in #226de6

**Status:** accepted
**Date:** 2026-09-20
**Decided by:** owner (product)

## Context
The owner walked the matches flow on the test server, found it good, and asked for two things.
The embed colour should be `#226de6` on everything the bot sends. Every message a player sees
should be an embed.

## Decision
1. Every embed uses the one brand colour `#226de6` (`BRAND_COLOR` in
   `src/discord/views/style.ts`). No embed sets its own colour.
2. Every message the bot sends is an embed built from the brand helper. This covers:
   - private replies and errors, including «кнопка устарела», missing rights and missing
     permissions;
   - confirmations;
   - recruitment messages and announcements;
   - the heartbeat and the log-channel lines.
3. **Discord limit:** a mention inside an embed does not notify anyone. So an announcement that
   must ping (teams formed, manual picking due, match cancelled) carries only the mentions as
   message text, with `allowedMentions` set to exactly those users. The words are in the embed.

## Rejected
- **Plain text for short errors.** The owner wants one look everywhere.
- **Mentions inside the embed only.** Nobody would be notified, which would break the pings of
  009 §4.

## Consequences
Every new screen goes through the brand helper. A unit test checks the colour of every view the
tests can build.
