# earnings — KP Coin outside matches

- **Owns:** `VoiceDay` (voice minutes and paid hours per player per Moscow day). The KP itself moves only through `economy.move`.
- **Interface:** `EarningsService` in `service.ts` — `dailyStatus`, `claimDaily`, `voiceTick(userIds, at)` (decision 014 §5–§6).
- **Daily bonus:** `GuildSettings.dailyBonusAmount` (50 by default, 0 = off) once per Moscow day (fixed UTC+3, `core/clock.ts moscowDay`), claimed by `/бонус` or «🎁 Ежедневный бонус» in `/профиль`. Reference `daily:<userId>:<day>`: a second claim, concurrent ones included, is `ALREADY_CLAIMED` with the next Moscow midnight.
- **Voice time:** `jobs/voice.ts` ticks every minute with the players `eligibleVoiceUsers` keeps (a voice channel that is not stage or AFK; not a bot or fake id; not deafened; at least one other non-bot, non-deafened member). One minute is credited with `lastTickAt < minute`, so overlapping ticks credit once; every full hour pays `voiceKpPerHour` (10) up to `voiceDailyCapKp` (60) a day, one transaction per player in userId order, reference `voice:<userId>:<day>:<hour>`. No back-pay for downtime; leftover minutes do not cross midnight.
- **Logging:** pino and the ledger only — never the log channel (014 §11).
- **Known limit:** alt accounts can satisfy «not alone»; the daily cap bounds the gain. Re-rule before KP transfers ship (014 §6).
- **Depends on:** `economy`, `settings`, `logging`.
- **Tests:** `service.db.test.ts` (real Postgres), `jobs/voice.test.ts` (eligibility), `core/clock.test.ts` (Moscow day).

Last verified: 2026-09-20
