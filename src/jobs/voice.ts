// Voice time (decisions 013 §4, 014 §6): every minute, the players `eligibleVoiceUsers` keeps get
// one minute; every full hour pays, up to the daily cap. There is no session table: the voice
// state cache is rebuilt on every connect, so downtime is simply not paid.
import type { Clock } from '../core/clock.js';
import { isFakeUserId } from '../core/match.js';
import type { VoiceSnapshot } from '../core/ports.js';
import type { EarningsService } from '../modules/earnings/service.js';
import type { LoggingService } from '../modules/logging/service.js';

export const VOICE_INTERVAL_MS = 60_000;

/**
 * Who earns this minute. A player counts when all hold (014 §6):
 * - the channel is a voice channel, not a stage channel, and not the AFK channel;
 * - the player is not a bot and not a fake id;
 * - the player is not self- or server-deafened (muted counts);
 * - at least one OTHER non-bot member in the channel is not deafened either.
 */
export function eligibleVoiceUsers(snapshot: VoiceSnapshot): string[] {
  const out: string[] = [];
  for (const channel of snapshot.channels) {
    if (channel.stage || channel.id === snapshot.afkChannelId) continue;
    const listening = channel.members.filter((m) => !m.bot && !isFakeUserId(m.userId) && !m.selfDeaf && !m.serverDeaf);
    if (listening.length < 2) continue; // alone, or only with bots and deafened people
    out.push(...listening.map((m) => m.userId));
  }
  return [...new Set(out)].sort();
}

export interface VoiceJobDeps {
  gateway: { voiceSnapshot(): Promise<VoiceSnapshot> };
  earnings: Pick<EarningsService, 'voiceTick'>;
  logging: Pick<LoggingService, 'failure'>;
  clock: Clock;
  isReady?: () => boolean;
}

export async function runVoiceTick(deps: VoiceJobDeps): Promise<{ eligible: number; credited: number; paid: number }> {
  const at = deps.clock.now();
  const users = eligibleVoiceUsers(await deps.gateway.voiceSnapshot());
  const result = await deps.earnings.voiceTick(users, at);
  return { eligible: users.length, credited: result.credited, paid: result.paid.length };
}

/** Starts the minute tick; returns the stop function. A slow tick is never overlapped. */
export function startVoiceJob(deps: VoiceJobDeps, intervalMs = VOICE_INTERVAL_MS): () => void {
  let running = false;
  const tick = () => {
    if (running || (deps.isReady && !deps.isReady())) return;
    running = true;
    runVoiceTick(deps)
      .catch((err: unknown) => deps.logging.failure('job.voice_failed', { err }))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
