// The one algorithm behind GuildGateway.ensureVoiceChannel (decision 008 §7): the stored id,
// then the exact name in the category, then create. Kept apart from discord.js so the db tests'
// fake gateway runs the same steps the real one does, and a crash between «created» and «id
// saved» is proven to adopt the channel instead of creating a second one.
import type { VoiceChannelSpec } from './ports.js';

export interface ChannelOps {
  /** The channel if it still exists as a voice channel, null if it is gone. */
  byId(id: string): Promise<{ id: string } | null>;
  /** A voice channel with exactly this name in this category, or null. */
  byName(categoryId: string, name: string): Promise<{ id: string } | null>;
  create(spec: VoiceChannelSpec): Promise<{ id: string }>;
  /** Full replace of the overwrites, so a replay converges. */
  setOverwrites(id: string, spec: VoiceChannelSpec): Promise<void>;
}

export async function ensureChannel(spec: VoiceChannelSpec, ops: ChannelOps): Promise<string> {
  const existing = (spec.currentId ? await ops.byId(spec.currentId) : null) ?? (await ops.byName(spec.categoryId, spec.name));
  if (existing) {
    await ops.setOverwrites(existing.id, spec);
    return existing.id;
  }
  return (await ops.create(spec)).id;
}
