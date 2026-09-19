---
id: work-order-and-doc-sync
tier: practice
---

# Docs first, then code; every change ends by updating the docs in the same pass

**Digest:** Order: read the canon and the route → design (a decision record when there is a
fork) → implement → verify with a machine-checked green → update every affected doc in the SAME
pass → branch, pull request, merge. Starting from the code and skipping the canon is a process
error. A doc that disagrees with the running bot is a unit of work, fixed in the same pass.

1. **Before the first edit:** `product/spec.md` for the area, `product/open-questions.md` (the
   answer may be pending), the relevant `product/decisions/`, the route in `FLOW.md`, the runbook
   if the work touches the server. Then the code.
2. **A plan is needed** when the work touches the server, changes what players see, or crosses
   two areas (economy and matches, shop and permissions). Small work inside one area: do it and
   report. An explicit task from the owner is finished, verified and merged, not left half-way.
3. **The design fork goes to the architect** and is written into a decision record before the
   code (rule `opus-decides-design`).
4. **Done means a machine said so:** the project gate (`npm run check` — typecheck, lint, tests —
   defined by `/init-project`) is green and quoted; for a server change, the live signal named in
   rule `bot-always-on` was observed. «It should work» is not done. A failing test is reported with
   its output, never softened or worked around by weakening the test.
5. **Doc-sync in the same pass**, by the sync map in `FLOW.md`: a behaviour change → `spec.md`;
   a decided fork → the decision record and `open-questions.md` (question removed); a server or
   deploy change → the runbook; a release → `docs/for-owner/status.md` (Russian, what the bot can
   do now). A footer `Last verified: <date>` on every touched doc.
6. **The arbiter is the live source** — the running bot, the server, the Discord server — not a
   doc. A discrepancy found during reconnaissance is fixed in the docs even if nothing else changes.
7. **Docs are for the agent** (English, one topic per file, a fixed shape per type, ≤ 2 000 tokens
   per file as a target); a decision is never compressed away. Texts for the owner are separate
   and Russian (`docs/for-owner/`).

**Why:** decisions and prohibitions that exist nowhere in the code get lost the moment a session
starts from the code. And a doc updated «in a follow-up» is updated by nobody: the next session
trusts a stale doc, rebuilds what exists or contradicts a decision already taken. The same-pass
rule is the only version that held on the previous project.
