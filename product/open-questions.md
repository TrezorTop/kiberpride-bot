# Open product questions

Forks the owner has not settled. Each entry: the question in the owner's terms, the options in
plain language, the agent's recommendation, and what the bot does meanwhile. Ask the owner
**only when the work reaches the question**, one at a time, in Russian, as options (rule
`plain-language` §4). A settled question moves to a decision record and is deleted here.

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

## Q13. How is the player warned that a purchase ends tomorrow?

Options:
- a private message from the bot;
- a ping in a chosen channel;
- only a note in `/магазин` and `/профиль`.

**Recommendation:** a private message; the note is always shown too. **Meanwhile:** a private
message (decision 014 §4).

## Q14. What GIF access really gives

Discord cannot separate «GIF» from «any link preview». GIF access means that buyers' GIFs and
link previews (YouTube and others) show in the chosen channels, and non-buyers' links stay plain
text. Image access also lets a buyer upload `.gif` files. **Recommendation:** accept this, since
it affects only the chosen channels. **Meanwhile:** built that way; measured on the test server.

## Q15. Clan rules

The clan is the buyer plus 10 members. A player can be in one clan only. The buyer adds members
directly, and a member can leave at any time. **Recommendation:** as described.
**Meanwhile:** as described.

## Q16. The clan role's colour visibility

A coloured role placed at the bottom is hidden behind any other coloured role the member has.
Placing it higher makes the colour show but mixes the clan role with staff roles.
**Recommendation:** place it just below the staff roles. The admin picks the anchor once.
**Meanwhile:** at the bottom.

## Q17. A buyer away from the server

A buyer who leaves the server keeps their purchase: the time runs on, and it comes back if they
return while it is still active. A personal room is visible to everyone but closed by default.
**Recommendation:** as described. **Meanwhile:** as described.

---

Last verified: 2026-09-20 (Q1 settled → decision 013; Q13–Q17 raised by decision 014; earlier:
Q7 → 006, Q8–Q12 → 009).
