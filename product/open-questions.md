# Open product questions

Forks the owner has not settled. Each entry: the question in the owner's terms, the options in
plain language, the agent's recommendation, and what the bot does meanwhile. Ask the owner
**only when the work reaches the question**, one at a time, in Russian, as options (rule
`plain-language` §4). A settled question moves to a decision record and is deleted here.

## Q1. Does bought access expire?

Image and GIF access: forever after one purchase, or for a period (say 30 days) and then bought
again? Forever is simpler and feels generous; a period makes KP keep circulating and gives the
shop a reason to exist after everyone has bought once. **Recommendation:** a period, configurable
per good, 30 days by default; the bot warns the player a day before it ends.
**Meanwhile:** the good has a validity field; the first release treats an empty value as forever.

## Q2. A player leaves the server mid-match

Their reward: paid anyway (they played), withheld, or decided by the organiser at finish?
**Recommendation:** the organiser decides at finish — the panel shows the player as «покинул
сервер» with a choice to pay or not. **Meanwhile:** withheld and logged; nothing is lost, the
organiser can pay by hand from the admin panel.

## Q3. Can the organiser cancel a match without rewards?

A recruitment that never fills, a match abandoned. **Recommendation:** yes, a «Отменить» button
on the match panel with a confirmation; players are notified, no KP moves, channels are removed.
**Meanwhile:** assumed yes — cancelling is part of the first release's match panel.

## Q4. Where does the player see their history?

Inside `/профиль` (last operations), a separate `/история`, or both? **Recommendation:** the
profile shows the last five with a button «Вся история» that opens the full list.
**Meanwhile:** built that way.

## Q5. Who may create activities?

Only organisers and above, or also moderators? And who may finish a match — only its creator or
any organiser? **Recommendation:** organiser and above create; the creator or any administrator
finishes. **Meanwhile:** built that way; it is configuration, so changing it costs nothing.

## Q6. Hosting budget and payment

The bot needs a small server outside Russia, paid in rubles, roughly 300–700 ₽ per month. Which
amount is acceptable, and who pays — the owner personally or the community? Asked when the
first release runs locally and is ready to go live. **Meanwhile:** the bot runs on the owner's
machine for tests only.

## Q7. Test server before the real one

The agent recommends a private test Discord server for every check before anything reaches the
real KiberPride server. Asked at `/init-project`. **Meanwhile:** assumed yes.

---

Last verified: 2026-09-19.
