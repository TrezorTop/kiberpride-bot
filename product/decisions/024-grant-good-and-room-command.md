# 024. `/выдать-товар` — an administrator hands out a good without a purchase; the room gets its own command

**Status:** accepted
**Date:** 2026-09-20
**Decided by:** owner (product)

## Context
The shop is live. The owner needs two more things: to hand a good to a player by hand — a prize,
a compensation, a room for a friend — without KP Coin changing hands, and a command that opens the
personal-room panel directly instead of going through `/магазин` or `/профиль`.

## Decision
1. **`/выдать-товар <игрок> <товар> [дней]`**:
   - any of the three goods may be handed out (the owner's answer «1а»);
   - the days are the administrator's, defaulting to 30 (answer «2б»); 1–365;
   - **no KP Coin move** — the ledger stays untouched and `pricePaid` is 0 for the period given;
   - everything else behaves exactly like a bought good: the role or room or clan appears through
     the same convergence, the end date works the same way, the warning a day before is the same,
     `/отозвать` ends it the same way;
   - handing out a good the player already has **extends** it by the days given, like a renewal;
   - a clan cannot be handed out without a name and colour, so for that good the command opens the
     same form the shop uses, with the player as the owner;
   - the player gets a private message: what they were given and until when.
2. **Who may:** hidden from non-administrators; allowed by `SHOP_MANAGE`, the same right that
   revokes (decision 023 §4).
3. **Every hand-out is one line in the log channel** naming the administrator, the player, the
   good and the days.
4. **`/моя-комната`** opens the personal-room panel («🏠 Моя комната») directly. The name avoids
   `/комната`, which the owner's other bot on the same server already uses. The panel and its
   rights are unchanged: only the room's owner sees it, and a player without a room is told where
   to get one.

## Rejected
- **Only the personal room (1б).** The owner wants the other two as well.
- **A fixed 30 days (2а).** Not the owner's choice.
- **Charging the player's balance.** A hand-out is a gift, not a purchase.
- **`/комната`.** Taken by the other bot; two identical names in one server's command list.

## Consequences
A handed-out good is indistinguishable from a bought one afterwards, except that its `pricePaid`
is 0 — so `/отозвать` with a refund returns nothing, which the screen must say plainly. The shop's
audit trail keeps the difference: a purchase has a ledger line, a hand-out has a log line only.
