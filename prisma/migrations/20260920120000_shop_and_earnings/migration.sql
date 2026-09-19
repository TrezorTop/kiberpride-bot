-- Shop renewals, clans, personal rooms, daily bonus and voice time (decisions 013, 014 §8, 015).
-- The new enum values are only added here, never used: Postgres refuses a value added in the
-- same transaction (no default, index or CHECK below mentions them).

-- AlterEnum
ALTER TYPE "PurchaseStatus" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "TxKind" ADD VALUE 'DAILY_BONUS';
ALTER TYPE "TxKind" ADD VALUE 'VOICE_TIME';

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "dailyBonusAmount" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "voiceDailyCapKp" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "voiceKpPerHour" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "cleanedAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastApplyError" TEXT,
ADD COLUMN     "periods" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "warnedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "Clan" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL,
    "roleId" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Clan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClanMember" (
    "id" SERIAL NOT NULL,
    "clanId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClanMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRoom" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT true,
    "guestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomGuest" (
    "id" SERIAL NOT NULL,
    "roomId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceDay" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "paidHours" INTEGER NOT NULL DEFAULT 0,
    "lastTickAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VoiceDay_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clan_purchaseId_key" ON "Clan"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ClanMember_userId_key" ON "ClanMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClanMember_clanId_userId_key" ON "ClanMember"("clanId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalRoom_purchaseId_key" ON "PersonalRoom"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomGuest_roomId_userId_key" ON "RoomGuest"("roomId", "userId");

-- CreateIndex
CREATE INDEX "Purchase_status_expiresAt_idx" ON "Purchase"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Clan" ADD CONSTRAINT "Clan_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClanMember" ADD CONSTRAINT "ClanMember_clanId_fkey" FOREIGN KEY ("clanId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRoom" ADD CONSTRAINT "PersonalRoom_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomGuest" ADD CONSTRAINT "RoomGuest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "PersonalRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written constraints Prisma cannot express (named in schema.prisma) ───
-- Each one has a firing test in tests/db/constraints.db.test.ts.

-- 014 §1: a chain of grant periods has at least the first one.
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_periods_positive" CHECK ("periods" >= 1);

-- 014 §8: 0 switches an earning off; a negative amount would debit players.
ALTER TABLE "GuildSettings" ADD CONSTRAINT "GuildSettings_dailyBonusAmount_nonnegative" CHECK ("dailyBonusAmount" >= 0);
ALTER TABLE "GuildSettings" ADD CONSTRAINT "GuildSettings_voiceKpPerHour_nonnegative" CHECK ("voiceKpPerHour" >= 0);
ALTER TABLE "GuildSettings" ADD CONSTRAINT "GuildSettings_voiceDailyCapKp_nonnegative" CHECK ("voiceDailyCapKp" >= 0);

-- 014 §3.2: the member counter stays inside what a clan can hold.
ALTER TABLE "Clan" ADD CONSTRAINT "Clan_memberCount_range" CHECK ("memberCount" BETWEEN 0 AND 25);

-- 014 §3.2: two open clans never share a name, whatever the letter case.
CREATE UNIQUE INDEX "Clan_open_name_key" ON "Clan" (lower("name")) WHERE "closedAt" IS NULL;

-- 014 §3.3: Discord's user limit is 0..99; guests use the counter pattern.
ALTER TABLE "PersonalRoom" ADD CONSTRAINT "PersonalRoom_userLimit_range" CHECK ("userLimit" BETWEEN 0 AND 99);
ALTER TABLE "PersonalRoom" ADD CONSTRAINT "PersonalRoom_guestCount_range" CHECK ("guestCount" BETWEEN 0 AND 25);

-- 014 §6: minute and hour counters never go below zero.
ALTER TABLE "VoiceDay" ADD CONSTRAINT "VoiceDay_minutes_nonnegative" CHECK ("minutes" >= 0);
ALTER TABLE "VoiceDay" ADD CONSTRAINT "VoiceDay_paidHours_nonnegative" CHECK ("paidHours" >= 0);
