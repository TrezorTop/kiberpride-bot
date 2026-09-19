# 016. Shop settings live in their own command, `/настройки-магазина`

**Status:** accepted (amends 014 §7)
**Date:** 2026-09-20
**Decided by:** owner (product)

## Context
Decision 014 §7 put the shop settings behind a «🛒 Магазин» button on the `/игры` settings
screen. The owner asked for a separate command instead: «не надо её совать в команду /игры».

## Decision
1. **`/настройки-магазина`** opens the shop settings screen:
   - the channels for media access;
   - the category for personal rooms;
   - the clan anchor role;
   - switching goods on and off.
2. The command shows in the command list only for members with Manage Server
   (`default_member_permissions`). The right that counts is still `SETTINGS_MANAGE`, checked by
   the command and again by the shop service on every change.
3. The `/игры` settings screen no longer has the «🛒 Магазин» button. The shop screen no longer
   has «⬅️ Настройки игр». Old buttons in messages already sent still work: their routes stay
   registered.

## Rejected
- **Keeping the shop inside `/игры`.** Not the owner's choice.

## Consequences
The future §7 admin panel may gather both settings screens again. Until then each area has its
own command.
