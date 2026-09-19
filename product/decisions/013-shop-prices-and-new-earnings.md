# 013. Shop prices, 30-day access, a daily bonus and voice-time earnings, clan role and personal room as goods

**Status:** accepted. Settles Q1 and extends spec §1, §2 and §10. The owner answered the pending
parts the same day: «1б 2а 3а 4б, цифры ок».
**Date:** 2026-09-20
**Decided by:** owner (product). The amounts the owner delegated («скоррелируй сам», «придумай
сам») were set by the lead from the economy below.

## Context
The owner answered the shop questions and added new earnings:
- Q1: access lasts 30 days.
- Prices: image access 3000, GIF access 5000. The owner wants them to take «active participation
  in events».
- A daily bonus.
- KP for time spent in voice channels, «not too much».
- A clan role and a personal Discord room, both expensive; the clan role should cost at least a
  month of active play.

## The economy these numbers rest on
An active player plays about 3 matches a day. That earns 3 × 25 for participation, about half
of 3 × 100 for wins, and an MVP now and then: about **250 KP a day**. The daily bonus and some
voice time add about **100 KP**. The total is about **350 KP a day**, or roughly **10 000 KP a
month**.

## Decision
1. **Q1 → bought access lasts 30 days.** The bot warns the player one day before it ends. When it
   ends, the role is taken back. Buying again while access is active extends it by 30 days.
2. **Prices** (configuration, changeable later):

   | Good | Price | For how long | Takes an active player about |
   |---|---|---|---|
   | Доступ к изображениям | 3 000 KP Coin | 30 days | 9 days |
   | Доступ к GIF | 5 000 KP Coin | 30 days | 2 weeks |
   | Клановая роль | 15 000 KP Coin | 30 days, then renewed | 6 weeks |
   | Личная комната | 10 000 KP Coin | 30 days, then renewed | a month |

3. **Daily bonus:** **50 KP Coin** once per calendar day, Moscow time. The player claims it with a
   button or a command, never automatically.
4. **Voice time:** **10 KP Coin per full hour**, capped at **60 KP Coin a day** (6 hours). An hour
   counts only when all of these hold:
   - the player is not alone in the channel with no other real person;
   - the player is not deafened;
   - the channel is not the server's AFK channel.

   The time is paid in whole hours, and every payment is a history line.
5. **Where image and GIF access work: only in the channels an administrator picks in the bot's
   settings, chosen from a list.** Outside those channels nothing changes. The test server is
   configured by the lead; the real server is configured at go-live.
6. **Clan role** (a new shop kind). Spec §2 put personal roles out of scope for the first
   release; the owner has now brought this one in.
   - The buyer names the role and picks its colour.
   - The buyer can give the role to **up to 10 members** of their clan and take it back.
   - It lasts 30 days and is then renewed at the same price.
7. **Personal room** (a new shop kind).
   - The buyer gets their own voice channel.
   - The buyer decides who may enter, and can rename it and set a user limit.
   - It lasts 30 days and is then renewed at the same price.
8. **Expiry is the same for every good:** a warning one day before the end, the grant taken back
   at the end. Renewing while the good is active extends it by 30 days.

## Rejected
- **Access forever (Q1a).** Not the owner's choice.
- **Cheaper access (300 / 500).** The owner wants access to reward active participation.
- **Paying voice time per minute, or with no cap.** Idling in voice would out-earn playing, and
  the owner asked for «не прям так много».

## Consequences
The first release grows by three kinds of earnings and two expensive goods. All amounts live in
configuration, so the owner can retune them without new code.
