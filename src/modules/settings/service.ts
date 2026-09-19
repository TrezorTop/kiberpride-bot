// Guild-wide settings: a singleton row with id = 1 (decision 003 §7). Created on first read.
import type { Db } from '../../db/client.js';

export interface GuildSettingsView {
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

const SINGLETON_ID = 1;

export function createSettingsService(db: Db): SettingsService {
  return {
    async get() {
      return toView(await db.guildSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID }, update: {} }));
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
