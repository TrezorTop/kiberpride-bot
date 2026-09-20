# 023. `/отозвать` — an administrator takes a purchase back, with or without a refund

**Status:** accepted
**Date:** 2026-09-20
**Decided by:** owner (product)

## Context
The shop is live on the real server. The owner needs to take a bought good back by hand: a
punishment, a mistake, a player who should not have it. Until now only expiry could end a
purchase.

## Decision
1. **`/отозвать <игрок>`** shows that player's active purchases with their end dates. The
   administrator picks one and chooses between two buttons (the owner's answer «1в»):
   - **«Снять без возврата»** — the grant ends, no KP Coin move;
   - **«Снять и вернуть монеты»** — the grant ends and the player gets back what they paid.
2. **What «the grant ends» means** is exactly what expiry already does: the media role is taken
   away, a clan is closed (its role deleted, its members freed), a personal room is deleted. The
   purchase's status becomes REVOKED with `revokedById` set to the administrator.
3. **The refund is the whole `pricePaid`** — the running total including renewals — and it is
   idempotent: one purchase can be refunded once (the reference `refund:<purchaseId>` already
   exists for the failed-apply refund of 014 §2).
4. **Who may:** hidden from non-administrators, allowed by the capability `SHOP_MANAGE` (so the
   owner can widen it in `/права`). This amends 020 §1's wording: `SHOP_MANAGE` now reads
   «управлять товарами магазина и отзывать покупки игроков» on that screen, because until now it
   only touched goods and never a player's property.
5. **The player is told** by a private message: what was taken, and whether the coins came back.
   The log channel keeps one line naming the administrator, the player, the good and the choice.

## Rejected
- **Always refunding.** The owner wants to be able to take a good away as a punishment.
- **Never refunding.** Then a mistake by an administrator costs the player their coins.
- **A partial refund for the time left.** Nothing in the shop is priced by the day, and the
  arithmetic would have to be explained to players.

## Consequences
An administrator can now end any purchase. Both the movement and the choice are in the log
channel. A revoked purchase does not stop the player buying the same good again. The result screen
says when the player's private messages are closed, so the administrator knows to tell them by
hand.

Filed, due 2026-09-27 (from the review of 2026-09-20):
- a refund of a zero `pricePaid` would tell the player «0 KP Coin вернулись» — make it «no
  refund»;
- the confirm screen does not say «доступ ещё не выдан» for a purchase that has not been applied
  yet, and revoking such a purchase without a refund silently cancels the automatic 30-minute
  refund the log channel promised;
- `revokeListView`'s unused `note` parameter.
