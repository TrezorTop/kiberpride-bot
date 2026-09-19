# 014. Shop and earnings design — renewals extend the grant row, grants converge per (user, good), bot-owned roles and rooms, a minute tick for voice time

**Status:** accepted; §7 amended by 016 (own command); §3.2 amended by 017 (review); §3.1 and §3.2 amended by 015 (one media good; the clan role sits below an admin-picked anchor). Amends 002 §5 (the kind handler contract) and 003 §3 and §6 (purchase
references, renewal, refund). Implements decision 013.
**Date:** 2026-09-20
**Decided by:** architect (technical). The product forks it raises are Q13–Q17; the bot is built
with the meanwhile behaviour.

## Context
Decision 013 fixed the prices, the 30-day validity, renewal by extension, the daily bonus, voice
pay, and two new goods. Four facts force the design:
- **Renewal breaks 003 §6.** One purchase now carries several payments.
- **Shared roles break per-purchase revoke.** Image and GIF access share one role. 002 §5's
  per-purchase `apply`/`revoke`, run after commit in any order, can remove a role a newer
  purchase paid for.
- **Discord cannot split «images» from «GIFs» cleanly.** `AttachFiles` covers every upload,
  `.gif` files included. `EmbedLinks` covers link previews, and the GIF picker posts a link.
- **Some Discord calls cannot move money.** The bot manages only roles below its highest role,
  and can set only permissions it holds itself.

## Decision
1. **Purchase and renewal** (amends 003 §6).
   - **One `Purchase` row is one chain of grant periods.** A renewal extends the row.
     - New columns: `periods Int @default(1)`, `warnedAt?`, `cleanedAt?`,
       `lastApplyError String?`.
     - `pricePaid` becomes the running total.
     - `PurchaseStatus` gains `REFUNDED`.
   - **References** (amends 003 §3): `purchase:<purchaseId>:<period>` and `refund:<purchaseId>`.
   - **New purchase, one transaction:**
     1. `INSERT Purchase` with `expiresAt = now()+validityDays`.
     2. For a clan, `INSERT Clan`; for a room, `INSERT PersonalRoom`.
     3. `economy.move(-price, 'purchase:<id>:1')`.

     The partial unique index on ACTIVE (user, good) stays, so a double buy rolls back.
   - **Renewal.** The confirm button is `kp1:shbuy:<goodId>:<expectedPeriods>`; 0 means a new
     purchase. One transaction:
     1. `UPDATE "Purchase" SET periods = periods+1, "pricePaid" = "pricePaid"+$price,
        "expiresAt" = GREATEST("expiresAt", now()) + $days, "warnedAt" = NULL WHERE
        user/good/ACTIVE AND periods = $expected AND "appliedAt" IS NOT NULL RETURNING periods`.
     2. No row back means `STALE_PANEL`.
     3. `economy.move(-price, 'purchase:<id>:<periods>')`.

     What the guards guarantee:
     - A double click renews once.
     - A renewal racing the expiry job either extends or finds EXPIRED, never both.
     - An unapplied purchase cannot be renewed.
     - A good with `validityDays = null` has no renewal.
   - **Price.** The current price is charged at confirm. Amounts never travel in a custom_id.
2. **Check before money, apply after commit, refund on permanent failure.**
   - **`kind.precheck(good, gw) → missing[]`** runs on cached guild data before the transaction.
     A problem means `SHOP_UNAVAILABLE` for the player and one line to the log channel. What it
     checks:
     - the bot's Manage Roles;
     - the target role below the bot's highest role;
     - for a clan, fewer than 250 guild roles;
     - the chosen channels exist and `@everyone` lacks the permission there;
     - for rooms, the bot's View, Connect, ManageChannels, ManageRoles and MoveMembers in the
       category, and fewer than 50 channels in it.
   - **Convergence replaces per-purchase apply and revoke** (amends 002 §5).
     `shop.reconcile(userId, goodId)` runs through a keyed coalescing queue, as in 008 §5.
     Each pass:
     1. Revokes every non-ACTIVE row with `cleanedAt IS NULL`, then sets `cleanedAt`. A shared
        kind skips the Discord call when an ACTIVE row exists.
     2. Applies the ACTIVE row and sets `appliedAt` with `WHERE status='ACTIVE'`.

     A commit during a pass enqueues another pass. `reconcileAll()` at startup repairs a lost
     queue. `buy` awaits its own pass for up to 8 s; after that the player sees «оплачено,
     доступ появится в течение пары минут».
   - **Retry.** The job in `jobs/grants.ts` runs every minute:
     - It re-enqueues ACTIVE rows with `appliedAt IS NULL` and non-ACTIVE rows with
       `cleanedAt IS NULL`.
     - Absent buyers are skipped; `guildMemberAdd` converges them when they return.
     - The first failure goes to the log channel with the Discord error code and is stored in
       `lastApplyError`.
   - **Refund.** An ACTIVE row with `appliedAt IS NULL` that is older than 30 minutes, whose
     buyer is present, is refunded inside the pass:
     1. `UPDATE … SET status='REFUNDED', "revokedAt"=now() WHERE id AND ACTIVE AND "appliedAt"
        IS NULL RETURNING "pricePaid"`.
     2. `economy.move(+pricePaid, 'refund:<id>', REFUND)`.

     Any partial Discord state is then cleaned up, the player is notified (§4) and the log
     channel gets a line. Unapplied rows cannot be renewed, so the refund is always one period.
3. **Kind handlers** (replaces 002 §5). Each handler has `configSchema`,
   `validate(good, gw) → problems[]`, `precheck`, `apply(grant, gw)`, `revoke(grant, gw)`,
   `sharedResource` and `describe`.
   1. **`channel_permission`** (`image_access`, `gif_access`). Config: `{ permission:
      'AttachFiles' | 'EmbedLinks', channelIds (1..25), roleId | null }`.
      - **The role.** A bot-created role with no guild permissions, not hoisted and not
        mentionable. Its id is saved at once. `ensureRole` finds it by the stored id, then by
        exact name, then creates it.
      - **Overwrites.** Per chosen channel: an `@everyone` deny of P and a role allow of P, set
        with `permissionOverwrites.edit` per target and **never `set`**. The bot sets them when
        the admin saves the channel list, and again in `validate` at startup. The screen says in
        one line that picking a channel is consent to this.
      - **Warnings.** `validate` warns about other roles that allow P there. It does not block,
        because staff may legitimately have it.
      - **Removing a channel from the list** deletes the role's overwrite and sets the
        `@everyone` value for P back to inherit. The screen says this.
      - **What each good gets:** image access is `AttachFiles`, which also allows uploading
        `.gif` files; GIF access is `EmbedLinks`, which covers picker GIFs and all link
        previews (Q14). This must be measured on the test server.
      - Shared resource.
      - `INVITE_PERMISSIONS` gains `AttachFiles`.
   2. **`clan_role`**. Config: `{ maxMembers: 10, forbiddenWords, palette (≤ 25 {label, rgb}) }`.
      - **Buying.** A new clan opens a modal: the name as text input and the colour as a
        palette select, never hex. The submit is `kp1:shclan:<goodId>`. A renewal uses the plain
        confirm.
      - **Name rules**, checked in the service and in the precheck:
        - trimmed, whitespace collapsed, 2–32 characters;
        - letters, digits, spaces, `-_.!?` and emoji; no `@ # : \``, no links or invites;
        - not equal to any other guild role name, `everyone` or `here`;
        - no forbidden word. The seed list: админ, модер, организатор, kiberpride, кибер, admin,
          mod, staff, owner, бот;
        - unique among open clans (partial unique on `lower(name) WHERE "closedAt" IS NULL`).

        There is no profanity filter. Names and renames are logged.
      - **The role** has permissions 0, is not mentionable and not hoisted, and sits at the
        bottom (Q16; the config reserves `anchorRoleId`).
      - **Convergence** makes `role.members` equal to {owner} ∪ the present `ClanMember` rows.
        Name and colour are written only on creation and on the owner's explicit rename;
        convergence never reverts a moderator's rename in Discord. It needs the full member
        cache, fetched once at bind.
      - **Members.**
        - `Clan.memberCount` has `CHECK (memberCount BETWEEN 0 AND 25)`.
        - An add is a guarded increment `WHERE "closedAt" IS NULL AND "memberCount" < $max` plus
          the insert; a unique violation rolls the counter back.
        - `ClanMember.userId` is `@unique`: one clan per person (Q15).
        - The buyer is not counted and cannot join another clan while owning one.
        - Bots and fake ids are refused.
      - **Panel.** The owner sees «➕ Добавить» (a user select), «➖ Убрать», «✏️ Название и
        цвет» and the expiry date. A member sees «🚪 Выйти из клана».
      - **Expiry.** The expiry transaction sets `Clan.closedAt` and deletes the member rows. The
        revoke deletes the role; «Unknown Role» counts as done. A renewal keeps the clan.
   3. **`personal_room`**. Config: `{ categoryId | null }`.
      - **Controls go through the bot.** The owner gets View and Connect only, never
        ManageChannels or Manage Permissions.
      - **Tables.** `PersonalRoom { purchaseId @unique, ownerId, channelId?, name, userLimit
        0..99, locked default true, guestCount 0..25 }`. `RoomGuest` uses the counter pattern.
      - **Convergence** makes sure the channel exists (by stored id, then exact name, then
        create) and sets its overwrites in full:
        - the bot: View, Connect, ManageChannels, MoveMembers;
        - the present owner and each guest: View and Connect;
        - `@everyone`: deny Connect when locked, inherit when open.
      - **Panel.** «✏️ Название», «👥 Лимит» (none, 2–10, 15, 20, 25), «🔒/🔓», «➕ Пустить» and
        «➖ Убрать». Removing a guest also disconnects them.
      - **Expiry** deletes the channel. A renewal keeps it.
   4. **Leaving the server.** The purchase stays ACTIVE and its time runs on (Q17).
      `guildMemberAdd` reconciles every ACTIVE key the returning player has. A clan member or
      room guest who leaves is deleted from the table, freeing the seat. An owner who leaves
      keeps the clan or the room.
4. **Expiry and warning** (`jobs/grants.ts`, every minute, no overlap).
   1. **Warning.** A claim-first `UPDATE … SET "warnedAt"=now() WHERE ACTIVE AND "warnedAt" IS
      NULL AND "expiresAt" <= now()+24h RETURNING`, then a DM.
      - A crash can lose a warning, but a warning is never sent twice.
      - If the DM is refused (50007), `/магазин` and `/профиль` still show «⏳ заканчивается
        <t:…:R>» (Q13).
   2. **Expiry.** `UPDATE … SET status='EXPIRED' WHERE ACTIVE AND "expiresAt" <= now()
      RETURNING`, in the same transaction as the clan closure, then the affected keys are
      enqueued.
   3. **Startup.** `validate` runs for every enabled good, then `reconcileAll()`, after the
      member cache is filled.
5. **Daily bonus.** `/бонус`, or «🎁 Ежедневный бонус» in `/профиль`.
   - The day is Moscow time, a fixed UTC+3 with no daylight saving: `moscowDay(d)` in
     `core/clock.ts`.
   - The reference is `daily:<userId>:<day>`. A second claim, including a concurrent one,
     returns `ALREADY_CLAIMED` with the next Moscow midnight.
   - The amount is `GuildSettings.dailyBonusAmount`; 0 means off.
6. **Voice time.** A job ticks every minute and keeps no session table.
   1. It reads `gateway.voiceSnapshot()` from the voice-state cache. The cache is rebuilt on
      every connect, so there is no back-pay for downtime.
   2. The pure function `eligibleVoiceUsers` keeps a player when all of these hold:
      - the channel is a voice channel, not a stage channel, and not the AFK channel;
      - the player is not a bot and not a fake id;
      - the player is not self-deafened or server-deafened (muted counts);
      - at least one other non-bot member in the channel is not deafened.
   3. `VoiceDay (userId, day)` credits the minute with `INSERT … ON CONFLICT DO UPDATE SET
      minutes = minutes+1, "lastTickAt" = $minute WHERE "lastTickAt" < $minute`, so overlapping
      ticks credit once. Leftover minutes do not carry over midnight.
   4. When `floor(minutes/60) > paidHours` and the cap allows, one transaction per user, in
      userId order, guards `paidHours` and calls `economy.move(+voiceKpPerHour,
      'voice:<userId>:<day>:<hour>', VOICE_TIME)`.

   Alt accounts can satisfy «not alone»; the daily cap bounds the gain. This must be re-ruled
   before KP transfers ship.
7. **Settings and seed.**
   - `/игры → ⚙️ Настройки` gains «🛒 Магазин» (requires `SETTINGS_MANAGE`), which opens:
     - multiple channel selects for image channels and for GIF channels;
     - a category select for rooms;
     - a good select with «Включить/Выключить».

     Each save runs `validate`; enabling is refused while problems remain.
   - Amounts are shown read-only; editing them belongs to the §7 admin panel.
   - `configure` and `setEnabled` take `actor` and check rights in the service (010 (d)).
   - The seed is create-only: `image_access` 3000, `gif_access` 5000, `clan_role` 15000 and
     `personal_room` 10000, all 30 days and disabled. `GuildSettings` gets 50, 10 and 60.
   - A disabled good is hidden and cannot be renewed; its active grants run out normally.
8. **Migration** (one). The hand-written SQL is noted in `schema.prisma`.
   - `TxKind` gains `DAILY_BONUS` and `VOICE_TIME`; `PurchaseStatus` gains `REFUNDED`.
   - `Purchase` gains the columns of §1, `CHECK (periods >= 1)`, and an index on `(status,
     "expiresAt")`.
   - `GuildSettings` gains `dailyBonusAmount`, `voiceKpPerHour` and `voiceDailyCapKp`, each with
     a `CHECK >= 0`.
   - New tables:
     - `Clan`, with the `memberCount` CHECK and the partial unique on `lower(name)`;
     - `ClanMember`, with `userId @unique` and `@@unique([clanId, userId])`;
     - `PersonalRoom`, with CHECKs;
     - `RoomGuest`, with `@@unique([roomId, userId])`;
     - `VoiceDay`, with `@@id([userId, day])` and CHECKs >= 0.
9. **Services** (no discord.js).
   - `ShopService`: `overview`, `quote`, `buy`, `reconcile`, `reconcileAll`, `expirePass`,
     `warnPass`, `retryPass`, `memberJoined`, `memberLeft`, `configure`, `setEnabled`.
   - `ClanService`: `forUser`, `addMembers`, `removeMember`, `leave`, `restyle`.
   - `RoomService`: `forOwner`, `update`, `addGuests`, `removeGuest`.
   - `EarningsService` (a new module): `dailyStatus`, `claimDaily`, `voiceTick`.
   - `EconomyService` adds `historyPage(userId, page, size=10)` and `devTopUp(actor, nonce,
     nodeEnv)`: +10 000 with reference `dev:<nonce>`, test server and guild owner only.
   - `GuildGateway` adds `ensureRole`, `deleteRole`, `roleMembers`, `setMemberRole`,
     `roleManageable`, `guildRoleNames`, `ensureAccessOverwrites`, `clearAccessOverwrite`,
     `ensureRoomChannel`, `disconnect`, `checkRoomCategory`, `voiceSnapshot` and `sendDm`.
10. **Screens.**
    - **`/магазин`** (ephemeral):
      - the balance;
      - the goods, each with price, validity, what it grants, and the player's state: «✅ до
        <date>», «⏳ выдаётся» or «⏳ заканчивается завтра»;
      - a good select (`kp1:shsel`) that opens a confirm screen with the price, the new end date
        and the balance after. When the player is short, the button is disabled and the screen
        says by how much;
      - the clan and room management buttons.
    - **«Вся история»**: `kp1:hist:<userId>` opens page 1, and `kp1:hpg:<userId>:<page>` pages
      through 10 lines at a time. Another user's history needs `ECONOMY_ADMIN`.
    - **`/профиль`** adds «Мои покупки», the bonus button, and the clan and room buttons.
11. **Logging.** The log channel gets purchases, renewals, refunds, expiries, apply failures,
    clan and room changes, and configuration changes. Daily-bonus and voice payments go only to
    pino and the ledger. This deliberately narrows `bot-always-on` §3: an hourly line per player
    would bury the lines that matter.
12. **Owner testing** (NODE_ENV not production, and the guild owner only, checked in the handler
    and in the service):
    - «🧪 +10 000 KP Coin» in `/профиль` (`kp1:dtop:<nonce>`);
    - «🧪 Закончить через 2 минуты» on an active grant.

## Rejected
- **A new Purchase row per renewal.** The active-row unique index would need a second status,
  and «is access active» would become a query across rows.
- **Per-purchase apply/revoke.** A late revoke of an old row removes a paid role.
- **Voice sessions stored from join and leave events.** Eligibility changes and missed events
  make sessions error-prone.
- **Room owners with ManageChannels or Manage Permissions.** They could rename, delete, or write
  their own overwrites.
- **Hex colour input.** Invisible colours and staff lookalikes.
- **`permissionOverwrites.set` on access channels.** It wipes the server's own overwrites.
- **Holding money until an admin notices a failed apply.** The player would pay for nothing.
- **A new `/настройки` command now.** The §7 control centre is its home.

## Consequences
- Every money guarantee is a database guard with a concurrent test.
- The bot now edits overwrites on channels it does not own and needs `AttachFiles` in its
  invite.
- Watch `sum(ledger) = balance` after every money test, and member overwrites for absent users
  (010 (b)).
- Open for the owner: Q13–Q17.
