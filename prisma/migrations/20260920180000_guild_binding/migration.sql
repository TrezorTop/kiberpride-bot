-- The guild these settings belong to. The bot moved from the test guild to the real one on
-- 2026-09-20 and kept the old guild's log channel id, which Discord answered with 50001
-- «Missing Access» — the log channel was never ensured and the heartbeat never posted.
-- With this column a guild change is noticed at bind, and every stored Discord id is dropped.
--
-- Left NULL on purpose: an existing deployment fills it at its next start with the guild it is
-- actually serving, so an upgrade in place is not mistaken for a guild change.

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "guildId" TEXT;
