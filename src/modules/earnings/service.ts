// Earnings outside matches (decisions 013 §3–§4, 014 §5–§6): the daily bonus and voice time.
// Both are ledger rows with references that make a second payment a no-op; neither is posted to
// the log channel (014 §11) — pino and the ledger carry them.
import { floorToMinute, moscowDay, nextMoscowMidnight, systemClock, type Clock } from '../../core/clock.js';
import { DomainError } from '../../core/errors.js';
import type { Db } from '../../db/client.js';
import { withTx } from '../../db/tx.js';
import { TxKind, type EconomyService } from '../economy/service.js';
import type { LoggingService } from '../logging/service.js';
import type { SettingsService } from '../settings/service.js';

export interface DailyStatus {
  /** 0 = the bonus is switched off. */
  amount: number;
  claimed: boolean;
  /** When the next Moscow day, and so the next bonus, begins. */
  nextAt: Date;
}

export interface VoicePayment {
  userId: string;
  day: string;
  hour: number;
  amount: number;
}

export interface EarningsService {
  dailyStatus(userId: string): Promise<DailyStatus>;
  /** ALREADY_CLAIMED (with the next midnight) on a second claim the same Moscow day. */
  claimDaily(userId: string): Promise<{ amount: number; balanceAfter: number; nextAt: Date }>;
  /** One minute for every eligible player; pays each full hour up to the daily cap. */
  voiceTick(userIds: readonly string[], at: Date): Promise<{ credited: number; paid: VoicePayment[] }>;
}

export interface EarningsDeps {
  db: Db;
  economy: EconomyService;
  settings: SettingsService;
  logging: LoggingService;
  clock?: Clock;
}

export const dailyReference = (userId: string, day: string) => `daily:${userId}:${day}`;
export const voiceReference = (userId: string, day: string, hour: number) => `voice:${userId}:${day}:${hour}`;

export function createEarningsService(deps: EarningsDeps): EarningsService {
  const { db, economy, settings, logging } = deps;
  const clock = deps.clock ?? systemClock;

  async function payHours(userId: string, day: string, perHour: number, capHours: number): Promise<VoicePayment[]> {
    const paid: VoicePayment[] = [];
    // Normally one hour is due; a raised cap can make several due at once.
    for (let guard = 0; guard < 24; guard++) {
      const payment = await withTx(db, async (tx) => {
        const rows = await tx.$queryRaw<{ paidHours: number }[]>`
          UPDATE "VoiceDay" SET "paidHours" = "paidHours" + 1
          WHERE "userId" = ${userId} AND "day" = ${day}
            AND "paidHours" < floor("minutes" / 60) AND "paidHours" < ${capHours}
          RETURNING "paidHours"`;
        const hour = rows[0]?.paidHours;
        if (hour === undefined) return null;
        await economy.move(
          { userId, amount: perHour, kind: TxKind.VOICE_TIME, reference: voiceReference(userId, day, hour), description: 'час в голосовых каналах' },
          tx,
        );
        return { userId, day, hour, amount: perHour };
      });
      if (!payment) break;
      paid.push(payment);
    }
    return paid;
  }

  return {
    async dailyStatus(userId) {
      const now = clock.now();
      const day = moscowDay(now);
      const { dailyBonusAmount } = await settings.get();
      const row = await db.kpTransaction.findUnique({ where: { reference: dailyReference(userId, day) }, select: { id: true } });
      return { amount: dailyBonusAmount, claimed: row !== null, nextAt: nextMoscowMidnight(now) };
    },

    async claimDaily(userId) {
      const now = clock.now();
      const day = moscowDay(now);
      const nextAt = nextMoscowMidnight(now);
      const { dailyBonusAmount } = await settings.get();
      if (dailyBonusAmount <= 0) throw new DomainError('DAILY_OFF');
      const reference = dailyReference(userId, day);
      // A claim before a settings change must not collide with the new amount's reference check.
      if (await db.kpTransaction.findUnique({ where: { reference }, select: { id: true } })) {
        throw new DomainError('ALREADY_CLAIMED', `user ${userId} day ${day}`, { at: nextAt });
      }
      const result = await economy.move({ userId, amount: dailyBonusAmount, kind: TxKind.DAILY_BONUS, reference, description: 'ежедневный бонус' });
      if (!result.applied) throw new DomainError('ALREADY_CLAIMED', `user ${userId} day ${day}`, { at: nextAt });
      await logging.event('earnings.daily', { userId, day, amount: dailyBonusAmount, balanceAfter: result.entry.balanceAfter });
      return { amount: dailyBonusAmount, balanceAfter: result.entry.balanceAfter, nextAt };
    },

    async voiceTick(userIds, at) {
      const ids = [...new Set(userIds)].sort();
      if (ids.length === 0) return { credited: 0, paid: [] };
      const minute = floorToMinute(at);
      const day = moscowDay(minute);
      // 014 §6: `lastTickAt < minute` makes an overlapping tick of the same minute credit nothing.
      const credited = await db.$queryRaw<{ userId: string }[]>`
        INSERT INTO "VoiceDay" ("userId", "day", "minutes", "paidHours", "lastTickAt")
        SELECT u, ${day}, 1, 0, ${minute} FROM unnest(${ids}::text[]) AS u
        ON CONFLICT ("userId", "day") DO UPDATE SET "minutes" = "VoiceDay"."minutes" + 1, "lastTickAt" = EXCLUDED."lastTickAt"
        WHERE "VoiceDay"."lastTickAt" < EXCLUDED."lastTickAt"
        RETURNING "userId"`;

      const { voiceKpPerHour, voiceDailyCapKp } = await settings.get();
      const capHours = voiceKpPerHour > 0 ? Math.floor(voiceDailyCapKp / voiceKpPerHour) : 0;
      const paid: VoicePayment[] = [];
      if (capHours > 0) {
        const due = await db.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM "VoiceDay"
          WHERE "day" = ${day} AND "userId" = ANY(${ids}::text[])
            AND "paidHours" < floor("minutes" / 60) AND "paidHours" < ${capHours}
          ORDER BY "userId"`;
        for (const { userId } of due) paid.push(...(await payHours(userId, day, voiceKpPerHour, capHours)));
      }
      for (const p of paid) await logging.event('earnings.voice_hour', { userId: p.userId, day: p.day, hour: p.hour, amount: p.amount });
      return { credited: credited.length, paid };
    },
  };
}
