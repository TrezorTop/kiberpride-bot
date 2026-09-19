# rules/ — the rule sources

One file = one rule, filename = slug. Every rule is imported in full into `CLAUDE.md` with an
`@rules/<slug>.md` line, so there is no generator and nothing to regenerate: **edit the rule file,
add the import line for a new one, delete both for a removed one.** No numbering; a rule is named by
its meaning.

## File shape

```markdown
---
id: <slug>                 # equals the filename
tier: invariant | practice # invariant — never broken; practice — a strong default, departed from
                           # only deliberately, with the reason written into a decision record
---

# Title

**Digest:** one or two sentences that work without the rest of the file — action plus boundary.

1. Numbered rules, one or two sentences each.

**Why:** one mandatory paragraph. A rule without its reason is an order the next session
«optimises» away.
```

## Discipline

- Target ≤ 350 words per rule: every rule sits in the context of every session.
- A rule is policy, not a live fact. Server addresses, prices, versions rot silently inside a rule
  and belong in a runbook or a decision record, linked from the rule.
- Weakening or removing an invariant is the owner's call, asked in plain language with the
  consequences spelled out (rule `plain-language`).
- The decision behind a rule is a record in `product/decisions/`; the rule points at it instead of
  retelling.
