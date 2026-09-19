# 003. First-release schema — a ledger with unique references, a cached balance guarded by conditional updates, Match as the one recruitment-to-result entity

**Status:** accepted
**Date:** 2026-09-19
**Decided by:** architect (technical)

## Context
Every KP movement must be recorded and applied at most once. Ten players can press «join» at
once. Balances must never go negative. The shop sells Discord permissions through roles with an
optional validity period (Q1: meanwhile, empty means forever). All money is integer KP.

## Decision
1. **Ids.** Internal ids are `Int @default(autoincrement())`, which keeps custom_ids short.
   Discord ids are `String` snowflakes. Times are `timestamptz`. There is no `guildId` column:
   one deployment serves one guild (002 §6).
2. **User** `{ id String @id (snowflake), balance Int @default(0), createdAt, updatedAt }`.
   Raw-SQL `CHECK (balance >= 0)`. A row is created on first contact by upsert.
3. **KpTransaction** (the ledger, append-only) has:
   - `id`, `userId`, `amount Int` (signed, `CHECK (amount <> 0)`), `balanceAfter Int`;
   - `kind TxKind` with the values MATCH_PARTICIPATION, MATCH_WIN, MATCH_MVP, MATCH_BONUS,
     PURCHASE, ADMIN_ADJUST and REFUND;
   - `reference String @unique`, `description String`;
   - `matchId Int?`, `purchaseId Int?`, `actorId String?`, `createdAt`;
   - `@@index([userId, createdAt])`.

   Reference formats, one per economic fact:
   - `match:<id>:participation:<userId>`, `match:<id>:win:<userId>`, `match:<id>:mvp:<userId>`;
   - `purchase:<purchaseId>`;
   - `admin:<nonce>`, where the nonce is minted when the admin modal opens and carried in its
     custom_id.
4. **`economy.move` is the only writer of balances.** It runs inside the caller's transaction:
   1. `INSERT … ON CONFLICT (reference) DO NOTHING RETURNING id`. No row back means it was
      already applied: return the existing row, a no-op.
   2. `UPDATE "User" SET balance = balance + $d WHERE id = $u AND balance + $d >= 0 RETURNING
      balance`. No row back means insufficient funds: throw, and the whole transaction rolls
      back.
   3. Write `balanceAfter` to the ledger row.

   A second transaction with the same reference blocks on the unique index until the first
   finishes, then becomes a no-op, or proceeds if the first rolled back. The isolation level is
   READ COMMITTED.
5. **ShopGood** has:
   - `id`, `slug @unique`, `name`, `description`, `price Int` (`CHECK > 0`);
   - `kind String`, validated against the registry (002 §5), and `config Json`, validated by
     the kind's schema;
   - `validityDays Int?` (null means forever), `enabled Boolean`, `sortOrder`, timestamps.
6. **Purchase** (a purchase and its grant are one row) has:
   - `id`, `userId`, `goodId`, `pricePaid Int`;
   - `status PurchaseStatus` (ACTIVE, EXPIRED, REVOKED);
   - `grantedAt`, `expiresAt?`, `appliedAt?` (null means the Discord role is not yet
     confirmed), `revokedAt?`, `revokedById?`.

   A partial unique index `(userId, goodId) WHERE status = 'ACTIVE'` (raw SQL) stops a double
   click from buying twice: the second insert violates it, the transaction rolls back, and no
   KP moves. The buy transaction does three things: insert the purchase, `economy.move(-price,
   'purchase:<id>')`, commit. The role is applied after the commit; the reconciler repairs
   `appliedAt IS NULL` and expired rows.
7. **Settings.**
   - `GuildSettings`: a singleton with `id = 1`, `logChannelId?`, `panelChannelId?`,
     `defaultRecruitChannelId?`, `defaultVoiceCategoryId?`, `autoMoveToVoice Boolean`,
     `updatedAt`.
   - `RoleCapability { roleId String, capability Capability, @@unique([roleId, capability]) }`.
   - `RewardRule { id, event RewardEvent (PARTICIPATION|WIN|MVP|DRAW), gameId Int?, amount Int,
     @@unique([event, gameId]) }`, where a rule for a specific game overrides the default rule.
   - `Game { id, slug @unique, name, emoji, defaultTeamSize Int, enabled }`.
8. **Match** (a recruitment and its match are one entity) has:
   - `id`, `gameId`, `title`, `teamSize Int` (`CHECK 2..10`), `capacity Int`
     (`= 2 * teamSize`);
   - `teamMode` (AUTO|MANUAL), `status MatchStatus` (decision 004), `version Int @default(0)`,
     `syncedVersion Int @default(-1)`;
   - `participantCount Int @default(0)` with `CHECK (participantCount BETWEEN 0 AND capacity)`;
   - `createdById`, `recruitChannelId`, `recruitMessageId?`, `voiceCategoryId`,
     `voiceChannelAId?`, `voiceChannelBId?`;
   - `rewards Json`, a snapshot of the resolved amounts taken at creation;
   - `winner Winner?` (A|B|DRAW), `mvpUserId?`;
   - `createdAt`, `closedAt?`, `startedAt?`, `endedAt?`, `endedById?`;
   - `@@index([status])`.
9. **Participant** has `id`, `matchId`, `userId`, `team Team?` (A|B), `joinedAt`,
   `leftServerAt?`, `@@unique([matchId, userId])` and `@@index([userId])`. Teams are this column
   plus the two voice ids on Match; there is no Team table. The result is the winner and MVP on
   Match plus the ledger rows that reference the match.
10. **Join serialisation.** One transaction:
    1. `UPDATE "Match" SET participantCount = participantCount + 1, version = version + 1
       [, status/teams per decision 004] WHERE id = $m AND status = 'RECRUITING' AND
       participantCount < capacity RETURNING …`. No row back means «набор закрыт».
    2. Insert the Participant. A unique violation rolls back the counter: «ты уже в игре».

    The row lock taken on Match serialises every roster change for that match in Postgres.
    Leave is the mirror: delete the participant, then decrement under the same status guard.

## Rejected
- **Balance as `SUM(ledger)`.** Keeping balances non-negative would still need a lock per user,
  and reads get slower as the ledger grows. The cached column plus the invariant test (002 §8)
  and a nightly drift check gives both.
- **SERIALIZABLE isolation.** It needs retry loops in every service. Conditional updates and
  unique indexes are narrower and deterministic.
- **Advisory or in-process locks for rosters.** They are invisible in the schema, and
  in-process locks break rule `bot-always-on` §2.
- **`Decimal` or float money.** KP has no fractions.
- **A separate Grant table.** It is 1:1 with Purchase in the first release; a future non-grant
  good leaves the grant columns null.
- **An enum for shop kind.** A new kind would need a migration; the registry validates it
  instead.
- **Reading reward amounts live at finish.** Changing a setting mid-match would change what the
  recruitment message promised.

## Consequences
Every idempotency guarantee is a database constraint and can be tested concurrently. CHECK
constraints and partial indexes are hand-written SQL in migrations, and Prisma does not know
them: each gets a comment in `schema.prisma`. Watch: `participantCount` must equal
`count(Participant)`. The `db` tests assert it after every roster operation.
