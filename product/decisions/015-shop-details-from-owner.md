# 015. Shop details settled by the owner — one media good, a DM warning, the clan rules, the clan colour shown

**Status:** accepted. Settles Q13–Q17, amends 013 §2 and §5 and 014 §3.1 and §3.2.
**Date:** 2026-09-20
**Decided by:** owner (product)

## Context
Decision 014 raised five product questions. The owner answered «1а 2б 3а 4а 5а».

## Decision
1. **Q13 → a DM.** The bot sends a private message one day before a purchase ends. `/магазин`
   and `/профиль` always show «⏳ заканчивается …» as well.
2. **Q14 → one good.** Discord cannot tell GIFs apart from link previews, so image access and
   GIF access become **one good, «Доступ к картинкам и GIF»**.
   - It grants both AttachFiles and EmbedLinks in the channels the admin picks: one role and
     one channel list.
   - It lasts 30 days.
   - **The price is 5 000 KP Coin for now**, the higher of the two earlier prices. The owner may
     change it.
3. **Q15 → the clan as proposed.** The buyer plus up to 10 members. A player can be in one clan
   only. The buyer adds members directly, and a member can leave at any time.
4. **Q16 → the clan colour is visible.** The clan role is placed just below an anchor role that
   the admin picks once in the shop settings, normally the lowest staff role. Without an anchor,
   the clan good cannot be switched on.
5. **Q17 → purchases survive a player's absence.** A buyer who leaves keeps the purchase and its
   time runs on; everything returns if they come back before it ends. A personal room is
   visible to everyone but locked by default.

## Rejected
- **Two separate goods for images and GIFs (Q14a).** What «GIF access» would mean in Discord
  terms confused the owner, and one good is simpler for players.
- **A ping in a channel, or a display note only (Q13b and c).** Not the owner's choice.
- **The clan role at the bottom (Q16b).** Its colour would be hidden behind other coloured
  roles.

## Consequences
The shop sells three goods: media access 5 000, clan role 15 000 and personal room 10 000, each
for 30 days. The settings screen gains an anchor-role select.
