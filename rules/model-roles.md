---
id: model-roles
tier: practice
---

# The session model plays every role; a delegation declares its role

**Digest:** Every helper — architect, builder, explorer, prober — runs on the session's own
model; nobody delegates a different model by id. What a delegation MUST declare is its ROLE: the
prompt opens with a `ROLE:` line naming a spec from `agents/`, and the read-only roles travel on
the read-only agent type. `tools/gate.mjs` refuses a delegation carrying `model` or missing its
`ROLE:` line.

1. **Roles** (`agents/<role>.md`): `architect` — decisions, forks, invariants, deletions,
   diagnoses, «refute this» reviews; travels on the read-only agent type. `builder` — code,
   tests, config, docs, carrying out a ruled decision; the only role with write tools.
   `explorer` — reconnaissance the lead will trust: mapping an area, finding where something
   lives; read-only. `prober` — one narrow question whose answer is a fact (does this file
   exist, what does this command print); read-only.
2. **One model, the session's.** The owner's decision 2026-10-07 (decision 025): the harness
   runs on ZCode and the session model is both the ceiling and the floor — architect, builder
   and explorer alike. No helper is silently cheaper than the session; if the owner ever names
   a different model, this rule is rewritten, not worked around.
3. **Facts may go to a tight brief.** `prober`'s answer must be a single verifiable fact — the
   cheapness is in the brief, not the model. Nothing that writes canon, rules, decisions or
   deletes code goes to a helper at all; that work stays with roles that carry the rules.
4. **Never a model id in a delegation.** Delegations carry no `model` field; the gate refuses
   one. A dated id pins a version that rots; which model plays the roles is named once, by the
   owner, in this rule.
5. **Every delegation declares its role** — a `ROLE: <name>` first line naming a spec from
   `agents/` (or a named ad-hoc role), on the agent type that matches its tool needs: read-only
   work on the read-only type, construction on the general-purpose type. The gate refuses a
   delegation with neither.
6. **The lead digs facts itself** when the fact is one command away; a helper is for bulky or
   parallel work, or for fresh context (the reviewer). No two helpers own the same file at once.

**Why:** measured on the previous project, one delegation in six went out with no model at all
and inherited whatever the session happened to run on; and reviews done by the same context that
built the code found nothing. On ZCode the calibre is fixed by the session itself, so it can no
longer be declared — the ROLE is what remains to declare, and the gate checks exactly that. The
fresh-context reviewer closes the second gap.
