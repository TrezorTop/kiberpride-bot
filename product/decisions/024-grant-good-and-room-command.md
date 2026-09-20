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
4. **`/комната [игрок]`** opens the personal-room panel («🏠 Моя комната») directly. The owner
   removed that command from their other bot, so the plain name is free.
   - With no option it opens the caller's own room; a player without one is told where to get it.
   - **With a player, it opens that player's room for an administrator** (the owner's answer:
     «админу можно дать такие доступы»). The right is `SHOP_MANAGE`, the same one that hands out
     and revokes goods, and it is checked in the service. An administrator can rename the room,
     set its limit, lock or open it, and let guests in or remove them — the same panel the owner of
     the room sees.
   - Every change an administrator makes to someone else's room is one line in the log channel.

## Rejected
- **Only the personal room (1б).** The owner wants the other two as well.
- **A fixed 30 days (2а).** Not the owner's choice.
- **Charging the player's balance.** A hand-out is a gift, not a purchase.
- **`/моя-комната`.** Proposed while the other bot still had `/комната`; the owner freed the name
  instead.

## Consequences
A handed-out good is indistinguishable from a bought one afterwards, except that its `pricePaid`
is 0 — so `/отозвать` with a refund returns nothing, which the screen must say plainly. The shop's
audit trail keeps the difference: a purchase has a ledger line, a hand-out has a log line only.

`pricePaid = 0` also reaches the automatic refund of a grant Discord never applied (014 §2): there
is no money to give back, so `economy.move` is not called at all — a zero move is refused and its
throw would roll the ending back and leave the convergence pass failing every minute for ever. The
purchase still leaves ACTIVE, the clan still closes, and the log line, the earlier «пробую каждую
минуту» warning and the player's private message all say «товар был выдан вручную — возвращать
нечего» instead of «0 KP Coin вернулись» (review of 2026-09-20, M1).

Every component of the room panel now carries the room's id (§4), so an ephemeral panel drawn by
an older deploy carries one argument fewer. Such a press is refused as a stale panel: a `<1|0>`
flag must be present and explicit, never inferred, or `rmlock:1` would read as «открыть комнату №1
для всех» (review of 2026-09-20, M2).

Filed, due 2026-09-27 (from the review of 2026-09-20):
- a hand-out extends a purchase that has never been applied, which a paid renewal refuses
  (`appliedAt IS NOT NULL`). The 30-minute window that ends an unapplied grant is measured from
  `grantedAt`, so the extension does not move it: an administrator can add days to a purchase that
  the next convergence pass then ends. Decide whether a hand-out must refuse an unapplied purchase
  (like a renewal), or re-arm the window.
