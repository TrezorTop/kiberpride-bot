---
id: opus-decides-design
tier: practice
---

# Design is decided by the architect, written down before code, refuted before merge

**Digest:** Any architectural or research decision belongs to the `architect` role (Opus), not to
whoever is writing the code, and it is WRITTEN into `product/decisions/` BEFORE the first commit of
that work. A closed step is reviewed by an architect on fresh context with «refute this» BEFORE the
merge. The owner outranks the architect on product; the architect outranks everyone on the
technical side.

1. **What goes through the architect:** choosing or changing a model (how match state flows, how
   rewards are computed, how recovery after restart works, the shop item abstraction); an
   invariant introduced, weakened or removed; a research question with more than one plausible
   answer («why does the button double-count», «why does the bot drop after an hour»); deleting a
   mechanism; any trade-off between product qualities.
2. **What the builder does alone:** gathers facts and measures; implements an accepted decision in
   full — tests, doc-sync, branch, pull request and merge included; fixes obvious defects where
   there is nothing to decide. Having to choose between two reasonable options IS a decision and
   goes to the architect.
3. **The decision lives in a record**, `product/decisions/NNN-<slug>.md` (format in that folder's
   README), and the pull request names it. A decision that exists only in chat does not exist:
   the thread compacts, the next session re-asks, and the same fork is decided twice differently.
4. **«Refute this», not «take a look».** After every closed step and before its merge the lead
   sends the architect: the decisions the architect did NOT dictate (where the builder could have
   erred), what was measured and what proves it, the observations that could not be explained.
   The verdict is `ACCEPTED` / `ACCEPTED WITH CHANGES` (each actionable) / `REJECTED` (with the
   failure it would cause). Review fixes are made or filed with a date; «later» does not exist.
5. **Fresh context.** The reviewer is a new architect agent, never the session that built the
   thing. The value is in the foreign eyes, not in the model's strength.
6. **The builder's own tests pin the builder's own error.** A green suite is evidence, not proof:
   the reviewer asks what a passing test would look like if the defect were present.
7. **The owner's product decision overrides any architect ruling.** The architect never overrides
   the owner; it only says, in plain language through the lead, what a product wish costs.

**Why:** an executor who finds a defect takes the design decision for it on the spot — fast,
local, almost always past the class of the problem — and six defects in a day turn out to be six
instances of two recurring design errors. A decision about the model belongs to whatever looks at
the area as a whole, and it must be written, because chat memory does not survive compaction.
Carried over from the Rubik VPN harness, where this was measured, with Opus in the architect's
seat (owner's decision 2026-09-19: Opus is the top model on this project).
