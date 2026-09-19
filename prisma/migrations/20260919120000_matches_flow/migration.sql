-- Matches in Discord (decision 008 §8, §11) and the owner's match rules (decision 009 §1, §5).

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "recruitTimeoutHours" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "announcedStatus" "MatchStatus",
ADD COLUMN     "special" BOOLEAN NOT NULL DEFAULT false;

-- ─── Hand-written constraints Prisma cannot express (named in schema.prisma) ───

-- 0 = never auto-close; a negative timeout has no meaning (decision 009 §5).
ALTER TABLE "GuildSettings" ADD CONSTRAINT "GuildSettings_recruitTimeoutHours_nonnegative" CHECK ("recruitTimeoutHours" >= 0);

-- A negative reward would debit players through economy.move (decision 008 §11).
ALTER TABLE "RewardRule" ADD CONSTRAINT "RewardRule_amount_nonnegative" CHECK ("amount" >= 0);
