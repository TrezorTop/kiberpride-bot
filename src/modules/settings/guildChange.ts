// Noticing that the deployment now serves a different guild (2026-09-20 defect).
//
// Every Discord id the bot stores is only meaningful inside one guild. When the bot was moved
// from the test guild to the real one, `GuildSettings.logChannelId` still held the test guild's
// channel; Discord answered the fetch with 50001 «Missing Access», the log channel was never
// ensured, and the heartbeat never reached Discord. `src/discord/missing.ts` makes a single such
// id heal itself; this pass drops the whole set at once, so the first start on a new guild is
// clean instead of healing one screen at a time.
//
// What is NOT touched: prices, goods, balances, the ledger, purchases, clans, rooms, rights
// rows, matches. None of them is a Discord id the bot resolves; the ones that are (Clan.roleId,
// PersonalRoom.channelId, Match voice channels) are re-created by their own ensure step, which
// now treats a foreign id as absent.
import type { Db } from '../../db/client.js';
import { SINGLETON_ID, type GuildSettingsPatch, type SettingsService } from './service.js';

/** The settings columns that hold a Discord id of the served guild. */
const CLEARED: GuildSettingsPatch = {
  logChannelId: null,
  panelChannelId: null,
  defaultRecruitChannelId: null,
  defaultVoiceCategoryId: null,
};

export interface GuildBindDeps {
  db: Db;
  settings: SettingsService;
  /**
   * A good's config with its Discord ids forgotten, or null when it holds none. Passed in, not
   * imported: `modules/settings` sits below every other module (decision 002 §2), so the shop
   * tells it where its ids are (`shop/kinds`'s `guildIdsPatch`, wired in src/main.ts).
   */
  goodIdsPatch: (kind: string, config: unknown) => Record<string, unknown> | null;
}

export type GuildBindOutcome =
  /** The stored guild is the served one: nothing to do, and every later start lands here. */
  | { kind: 'same' }
  /** First start (or the first after the column was added): the guild is remembered as is. */
  | { kind: 'stored' }
  | { kind: 'changed'; previousGuildId: string; goodsCleared: number };

/**
 * Binds the settings to the guild this deployment serves. Idempotent: called on every start and
 * on every `guildCreate`, it writes only when the stored guild differs.
 */
export async function bindGuildSettings(deps: GuildBindDeps, guildId: string): Promise<GuildBindOutcome> {
  const stored = (await deps.settings.get()).guildId;
  if (stored === guildId) return { kind: 'same' };
  if (stored === null) {
    await deps.settings.update({ guildId });
    return { kind: 'stored' };
  }

  const goods = await deps.db.shopGood.findMany({ select: { id: true, kind: true, config: true } });
  const patches = goods
    .map((good) => ({ id: good.id, patch: deps.goodIdsPatch(good.kind, good.config) }))
    .filter((entry): entry is { id: number; patch: Record<string, unknown> } => entry.patch !== null);

  // One transaction: a crash half-way must not leave the settings pointing at the new guild
  // while the goods still hold the old guild's channels. The goods are patched with jsonb `||`,
  // the same merge the settings screen uses, so only the id keys are rewritten.
  await deps.db.$transaction([
    deps.db.guildSettings.update({ where: { id: SINGLETON_ID }, data: { ...CLEARED, guildId } }),
    ...patches.map(
      (entry) =>
        deps.db.$executeRaw`UPDATE "ShopGood" SET "config" = "config" || ${JSON.stringify(entry.patch)}::jsonb, "updatedAt" = now() WHERE "id" = ${entry.id}`,
    ),
  ]);
  return { kind: 'changed', previousGuildId: stored, goodsCleared: patches.length };
}
