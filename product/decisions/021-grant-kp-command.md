# 021. `/начислить` — an administrator moves KP Coin by hand, in both directions

**Status:** accepted
**Date:** 2026-09-20
**Decided by:** owner (product)

## Context
On the live server the owner needs to hand out KP Coin by hand: a prize, a fix for a mistake, a
reward the bot does not know about. The old Python bot already owns `/выдать`, so the name must
differ.

## Decision
1. **`/начислить <игрок> <сколько> [за что]`**:
   - a positive amount pays the player, a negative one takes coins back (the owner's answer «1а»);
   - the balance never goes below zero: taking more than the player has is refused with a message
     saying how much they have;
   - «за что» is free text shown in the player's history; when it is empty the line reads
     «начислено администратором».
2. **Who may:** the command is hidden from everyone except members whose role carries Discord's
   Administrator permission, and the capability `ECONOMY_ADMIN` is what actually allows it, so the
   owner can widen it in `/права` (decision 020).
3. **Every movement is one history line** for the player and one line in the log channel naming
   the administrator, the player and the amount.
4. **Applied at most once:** the command mints a reference per invocation (`admin:<nonce>`,
   decision 003 §3), so a repeated click cannot pay twice.

## Rejected
- **`/выдать`.** Taken by the owner's other bot on the same server.
- **Two commands, one to give and one to take.** One command with a sign is fewer things to
  remember, and the confirmation says in words what will happen.
- **Letting a balance go negative.** The economy's rule since decision 003 §4.

## Consequences
An administrator can mint KP Coin, which is deliberate and logged. The log channel is the audit
trail; if the owner ever wants a limit per day, that is a new decision.
