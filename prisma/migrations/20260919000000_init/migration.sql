-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('MATCH_PARTICIPATION', 'MATCH_WIN', 'MATCH_MVP', 'MATCH_BONUS', 'PURCHASE', 'ADMIN_ADJUST', 'REFUND');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "Capability" AS ENUM ('ACTIVITY_CREATE', 'MATCH_MANAGE_ANY', 'ECONOMY_ADMIN', 'SHOP_MANAGE', 'SETTINGS_MANAGE');

-- CreateEnum
CREATE TYPE "RewardEvent" AS ENUM ('PARTICIPATION', 'WIN', 'MVP', 'DRAW');

-- CreateEnum
CREATE TYPE "TeamMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('RECRUITING', 'TEAMS_PENDING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Winner" AS ENUM ('A', 'B', 'DRAW');

-- CreateEnum
CREATE TYPE "Team" AS ENUM ('A', 'B');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpTransaction" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "kind" "TxKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "matchId" INTEGER,
    "purchaseId" INTEGER,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopGood" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "validityDays" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopGood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "goodId" INTEGER NOT NULL,
    "pricePaid" INTEGER NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "appliedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" TEXT,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "logChannelId" TEXT,
    "panelChannelId" TEXT,
    "defaultRecruitChannelId" TEXT,
    "defaultVoiceCategoryId" TEXT,
    "autoMoveToVoice" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleCapability" (
    "id" SERIAL NOT NULL,
    "roleId" TEXT NOT NULL,
    "capability" "Capability" NOT NULL,

    CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRule" (
    "id" SERIAL NOT NULL,
    "event" "RewardEvent" NOT NULL,
    "gameId" INTEGER,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "RewardRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "defaultTeamSize" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "gameId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "teamMode" "TeamMode" NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'RECRUITING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "syncedVersion" INTEGER NOT NULL DEFAULT -1,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "recruitChannelId" TEXT NOT NULL,
    "recruitMessageId" TEXT,
    "voiceCategoryId" TEXT NOT NULL,
    "voiceChannelAId" TEXT,
    "voiceChannelBId" TEXT,
    "rewards" JSONB NOT NULL,
    "winner" "Winner",
    "mvpUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "endedById" TEXT,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "team" "Team",
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftServerAt" TIMESTAMPTZ(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KpTransaction_reference_key" ON "KpTransaction"("reference");

-- CreateIndex
CREATE INDEX "KpTransaction_userId_createdAt_idx" ON "KpTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopGood_slug_key" ON "ShopGood"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RoleCapability_roleId_capability_key" ON "RoleCapability"("roleId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRule_event_gameId_key" ON "RewardRule"("event", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Participant_userId_idx" ON "Participant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_matchId_userId_key" ON "Participant"("matchId", "userId");

-- AddForeignKey
ALTER TABLE "KpTransaction" ADD CONSTRAINT "KpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpTransaction" ADD CONSTRAINT "KpTransaction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpTransaction" ADD CONSTRAINT "KpTransaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "ShopGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written: constraints Prisma cannot express (decision 003) ─────────
-- Each one is named in prisma/schema.prisma next to its model and must have a db test that
-- makes it fire. Everything above this line is generated by `prisma migrate diff`.

-- 003 §2: a balance never goes negative, whatever code path writes it.
ALTER TABLE "User" ADD CONSTRAINT "User_balance_nonnegative" CHECK ("balance" >= 0);

-- 003 §3: a ledger row always moves money.
ALTER TABLE "KpTransaction" ADD CONSTRAINT "KpTransaction_amount_nonzero" CHECK ("amount" <> 0);

-- 003 §5: nothing in the shop is free.
ALTER TABLE "ShopGood" ADD CONSTRAINT "ShopGood_price_positive" CHECK ("price" > 0);

-- 003 §6: a double click cannot buy the same good twice while it is active.
CREATE UNIQUE INDEX "Purchase_one_active_per_user_good" ON "Purchase"("userId", "goodId") WHERE "status" = 'ACTIVE';

-- 003 §7: one default rule per event (NULLs are distinct in the @@unique above).
CREATE UNIQUE INDEX "RewardRule_event_default_key" ON "RewardRule"("event") WHERE "gameId" IS NULL;

-- 003 §8: team formats 2x2 .. 10x10, capacity is both teams, the counter stays inside it.
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamSize_range" CHECK ("teamSize" BETWEEN 2 AND 10);
ALTER TABLE "Match" ADD CONSTRAINT "Match_capacity_twice_teamSize" CHECK ("capacity" = 2 * "teamSize");
ALTER TABLE "Match" ADD CONSTRAINT "Match_participantCount_range" CHECK ("participantCount" BETWEEN 0 AND "capacity");
