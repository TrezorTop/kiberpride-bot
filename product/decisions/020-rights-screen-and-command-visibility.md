# 020. Rights are given to roles from `/права`; admin commands are hidden from players

**Status:** accepted (amends 016 §2; settles Q5's «configuration» promise)
**Date:** 2026-09-20
**Decided by:** owner (who sees what, which roles) and architect (the mechanism)

## Context
The bot is going live on the real KiberPride server, where players already are. Until now the
only holders of every capability were the guild owner and members with Discord's Administrator
permission: `RoleCapability` had no screen, so «rights are configuration» (spec, Q5) was true only
in the schema. And `/игры` was visible to everyone and merely refused — on a live server that is
an invitation to press.

The owner named the roles: **Server Administrator** (everything) and **Организатор** (creates
games).

## Decision
1. **`/права`** — an ephemeral screen listing every capability, the roles that hold it, and one
   plain-Russian line explaining each:
   - `ACTIVITY_CREATE` — создавать наборы на игры;
   - `MATCH_MANAGE_ANY` — управлять любым матчем, а не только своим;
   - `ECONOMY_ADMIN` — смотреть чужую историю и начислять KP Coin вручную;
   - `SHOP_MANAGE` — управлять товарами магазина;
   - `SETTINGS_MANAGE` — менять настройки бота.

   A capability is picked from a select, then a role select (pre-filled, multi, ≤ 25) replaces the
   whole set for it. `@everyone`, managed and bot roles are refused, and a refused role refuses the
   whole save — never a partial write. Every change is logged to the log channel with the actor.
2. **Visibility** (`default_member_permissions = 0`): `/игры`, `/настройки-магазина` and `/права`
   are hidden from everyone except members whose role carries Discord's Administrator permission.
   The owner shows `/игры` to «Организатор» in Server Settings → Integrations. This amends 016 §2,
   which said Manage Server for `/настройки-магазина`.
   `/баланс`, `/профиль`, `/магазин` and `/бонус` stay visible to every player.
3. **Visibility is not a right.** The capability check in the service is the guard; hiding a
   command only keeps it out of the players' way. Granting a role the command in Integrations
   without granting the capability in `/права` gets a polite refusal.
4. **Nobody can be locked out:** the guild owner and Administrator members hold every capability
   implicitly, whatever `RoleCapability` says.
5. **Concurrency:** two admins saving the same capability at once are serialised by a
   transaction-scoped advisory lock keyed on the capability — the first advisory lock in this
   repository — because delete-then-insert at READ COMMITTED can otherwise interleave two sets.

## Rejected
- **Editing the database by hand** to grant rights. The owner never touches a terminal.
- **Manage Server as the visibility gate** (016 §2). The owner asked for Administrator only.
- **Hiding `/магазин` until go-live.** The players' commands stay open; what is switched off is the
  goods, which the shop settings control.
- **Deriving organisers from a role name** («Организатор»). A rename would silently drop rights.

## Consequences
The go-live checklist gains three owner steps: `/права` → grant «Организатор» the game right,
Integrations → show `/игры` to that role, and the bot's settings screens. Watch: a role deleted in
Discord leaves a stale `RoleCapability` row; it grants nothing, and voice overwrites already drop
unknown role ids (017 §4).
