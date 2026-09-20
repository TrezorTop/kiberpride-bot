// Guild-wide settings: a singleton row with id = 1 (decision 003 §7). Created on first read.
import type { Db } from '../../db/client.js';

export interface GuildSettingsView {
  /** The guild every id below belongs to; written by the guild bind only (./guildChange.ts). */
  guildId: string | null;
  logChannelId: string | null;
  panelChannelId: string | null;
  defaultRecruitChannelId: string | null;
  defaultVoiceCategoryId: string | null;
  autoMoveToVoice: boolean;
  /** An unfilled recruitment is cancelled after this many hours; 0 = never (decision 009 §5). */
  recruitTimeoutHours: number;
  /** KP of the daily bonus; 0 = off (decision 014 §5). */
  dailyBonusAmount: number;
  /** KP per full hour in voice and the most it pays in one Moscow day (decision 014 §6). */
  voiceKpPerHour: number;
  voiceDailyCapKp: number;
}

export type GuildSettingsPatch = Partial<GuildSettingsView>;

/** The choices the `/игры` settings screen offers for the recruit timeout (decision 009 §5). */
export const RECRUIT_TIMEOUT_CHOICES = [0, 1, 2, 3, 6, 12, 24] as const;

export interface SettingsService {
  get(): Promise<GuildSettingsView>;
  update(patch: GuildSettingsPatch): Promise<GuildSettingsView>;
}

/** The one settings row (decision 003 §7); `guildChange.ts` writes it too. */
export const SINGLETON_ID = 1;

export function createSettingsService(db: Db): SettingsService {
  return {
    async get() {
      const row = await db.guildSettings.findUnique({ where: { id: SINGLETON_ID } });
      if (row) return toView(row);
      // Prisma's upsert is read-then-write: two first reads at once would both try to create.
      await db.$executeRaw`INSERT INTO "GuildSettings" ("id") VALUES (${SINGLETON_ID}) ON CONFLICT ("id") DO NOTHING`;
      return toView(await db.guildSettings.findUniqueOrThrow({ where: { id: SINGLETON_ID } }));
    },
    async update(patch) {
      return toView(
        await db.guildSettings.upsert({
          where: { id: SINGLETON_ID },
          create: { id: SINGLETON_ID, ...patch },
          update: patch,
        }),
      );
    },
  };
}

function toView(row: GuildSettingsView): GuildSettingsView {
  return {
    guildId: row.guildId,
    logChannelId: row.logChannelId,
    panelChannelId: row.panelChannelId,
    defaultRecruitChannelId: row.defaultRecruitChannelId,
    defaultVoiceCategoryId: row.defaultVoiceCategoryId,
    autoMoveToVoice: row.autoMoveToVoice,
    recruitTimeoutHours: row.recruitTimeoutHours,
    dailyBonusAmount: row.dailyBonusAmount,
    voiceKpPerHour: row.voiceKpPerHour,
    voiceDailyCapKp: row.voiceDailyCapKp,
  };
}
