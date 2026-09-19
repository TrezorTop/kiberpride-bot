---
id: model-roles
tier: practice
---

# Calibre follows the work; Opus is the ceiling

**Digest:** Opus is the strongest model on this project — the architect, the builder and the
explorer run on it. A cheaper model is used only for a single fact a machine or the lead can check
at a glance. Every delegation names a role from `.claude/agents/` (which fixes the model and
effort) or passes an explicit `model` plus a `ROLE:` line; a delegation naming `fable` is refused
by the gate.

1. **Roles** (`.claude/agents/`): `architect` — decisions, forks, invariants, deletions,
   diagnoses, «refute this» reviews; no write tools. `builder` — code, tests, config, docs,
   carrying out a ruled decision. `explorer` — reconnaissance the lead will trust: mapping an
   area, finding where something lives. `prober` — one cheap question whose answer is a fact
   (does this file exist, what does this command print).
2. **Opus everywhere judgement is involved.** The owner's decision 2026-09-19: the top available
   model is Opus, and the difference between models below it is not worth a wrong answer that
   nobody catches. So `architect`, `builder` and `explorer` are Opus, with effort chosen by the
   work (a walk of the tree is `medium`, a design ruling is `high`).
3. **Cheap only where a wrong answer is caught, not believed.** `prober` runs on a cheaper model
   because its answer is a single verifiable fact. Nothing that writes canon, rules, decisions or
   deletes code goes to a cheap model.
4. **Name models by alias** (`opus`, `sonnet`, `haiku`), never by a dated id: an alias tracks the
   latest stable version, a pinned id rots.
5. **Every delegation declares its calibre** — a catalogue role and no `model` in the call, or an
   explicit `model` with a matching `ROLE:` line in the prompt. `tools/gate.mjs` refuses a
   delegation with neither, and any delegation naming `fable`.
6. **The lead digs facts itself** when the fact is one command away; a helper is for bulky or
   parallel work, or for fresh context (the reviewer). No two helpers own the same file at once.

**Why:** measured on the previous project, one delegation in six went out with no model at all
and inherited whatever the session happened to run on; and reviews done by the same context that
built the code found nothing. Declaring the calibre closes the first gap; the fresh-context
reviewer closes the second. Opus as the ceiling is the owner's constraint for this project.
