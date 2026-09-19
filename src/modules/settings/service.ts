// Guild-wide settings: a singleton row with id = 1 (decision 003 §7). Created on first read.
import type { Db } from '../../db/client.js';

export interface GuildSettingsView {
  logChannelId: string | null;
  panelChannelId: string | null;
  defaultRecruitChannelId: string | null;
  defaultVoiceCategoryId: string | null;
  autoMoveToVoice: boolean;
}

export type GuildSettingsPatch = Partial<GuildSettingsView>;

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
  };
}
