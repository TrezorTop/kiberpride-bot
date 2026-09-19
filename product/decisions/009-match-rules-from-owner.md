# 009. Match rules settled by the owner — ×2 special match, one started match at a time, optional MVP, pings, auto-close of stale recruitments

**Status:** accepted (settles Q8–Q12; amends 008 §3, §6, §8 and 004 §4)
**Date:** 2026-09-19
**Decided by:** owner (product); the placement in Discord was chosen by the lead and is subject
to the architect's review

## Context
Decision 008 raised five product forks: Q8 to Q12. The owner answered them all in one message:
«1в 2в 3б 4а 5 а и б».

## Decision
1. **Q8 → a ×2 «special match» switch.** An organiser may mark one match as special, and every
   reward of that match is then doubled: participation, win, MVP and draw. Organisers still
   never type amounts.
   - **Where it lives:** the match panel shows `⭐ Особый матч ×2` as a toggle while the match
     is RECRUITING. The creation modal is full at 5 components.
   - **What it changes:** the `Match.rewards` snapshot is recomputed from the settings, times 2
     or times 1. The recruitment message shows «⭐ Особый матч — награды ×2».
   - **Guards:** the toggle is status-guarded (RECRUITING only) and bumps `version`. It is
     logged.
2. **Q9 → a player in a match that has started cannot join another recruitment.**
   - `join` refuses with a clear message while the player is a participant, not marked as left,
     of any IN_PROGRESS match.
   - Being signed up to several recruitments at once is allowed.
   - When a match starts, the player's sign-ups elsewhere are kept.
3. **Q10 → MVP is optional.**
   - The MVP select at finish has a first option, «Без MVP».
   - The confirm custom_id carries `0` for it.
   - With no MVP, no MVP reward is paid, and the result card says «MVP не выбран».
4. **Q11 → pings as built in 008 §8.** The players are pinged when teams form, and the creator
   when manual picking is due. There are no per-join pings and no DMs.
5. **Q12 → both: the organiser can cancel at any time, and a recruitment that stays unfilled
   closes by itself.**
   - A RECRUITING match older than `GuildSettings.recruitTimeoutHours` is cancelled by a
     periodic job in `src/jobs/`, through the same cancel path as the organiser's cancel. The
     players are pinged, no KP moves, and the log channel records «набор закрыт по времени».
   - The default is **3 hours**. It is shown and changed on the `/игры` settings screen. `0`
     means never.
   - TEAMS_PENDING and IN_PROGRESS matches never time out.

## Rejected
- **No reward changes at all (Q8a).** Not the owner's choice.
- **Blocking any second sign-up (Q9b).** Not the owner's choice.
- **Mandatory MVP (Q10a).** Not the owner's choice.
- **Auto-close only, with no manual cancel (Q12b alone).** The owner wants both.

## Consequences
- The ×2 switch is the one way an organiser raises payouts. It is logged with the organiser's
  id, so misuse is visible in the log channel.
- The 3-hour default is the lead's guess, and the owner can change it on the settings screen.
