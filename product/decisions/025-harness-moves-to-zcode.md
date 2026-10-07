# 025. The harness runs on ZCode — the session model plays every role

**Status:** accepted
**Date:** 2026-10-07
**Decided by:** owner

## Context

The repository's harness — boot context, helper roles, session hooks, tool-call gate — was built
for Claude Code, with Opus fixed by alias as the strongest model (recorded in the rules,
2026-09-19). The owner now works in ZCode and asked the harness to be retargeted to it. A port
inspection also found that the old hook wiring (`… 2>/dev/null || true`) flattened the gate's
exit code and swallowed its refusal text, so the gate had never actually blocked a call.

## Decision

1. The boot context is `AGENTS.md`; every rule is mirrored into it in full from `rules/` under a
   hash-pinned block, and `tools/preflight.mjs` compares both the hash and the body at every
   session start, so a change on either side alone is named.
2. Hooks live in `.zcode/config.json` (`hooks.enabled`): preflight on `SessionStart`, the gate on
   `PreToolUse` for `Bash` and `Agent`. The gate blocks for real now: a refusal is exit 2 with
   the reason on stderr.
3. The helper roles live in `agents/` and are delegated with a `ROLE:` first line: architect,
   explorer and prober travel on the read-only agent type, builder on the general-purpose type.
   No delegation carries a `model` — the session model is both the ceiling and the floor; the
   gate refuses a `model` field or a missing `ROLE:` line (rule `model-roles`, rewritten).
4. The old rule `opus-decides-design` is renamed `architect-decides-design` — the invariant
   (the architect decides, records before code, refutation before merge) is unchanged; only the
   model identity behind the seat moved. `/init-project` is kept as `.zcode/skills/`.
5. `.claude/` and `CLAUDE.md` are removed; the removal is reversible from git history.

## Rejected

- Running both harnesses side by side — two rule texts and two gates drift apart, and a session
  follows whichever it loaded first.
- Naming a replacement model by id or alias — ZCode has no project-fixed alias here, and a dated
  id rots; which model plays the roles is said once, in rule `model-roles`.
- Keeping the harness client-neutral with no boot file — the rules then reach no session at all.

## Consequences

A rule edit now touches two places (`rules/` and the `AGENTS.md` mirror); preflight names a
drift in both directions — a changed rule without a re-mirror, and a mirror block left behind
by a deletion or rename — so it cannot rot silently. Fresh-context review survives unchanged.
If the owner later names a different model, rule `model-roles` is rewritten, not worked around.

The hook payloads are built on ZCode's documented schema, but the Agent `PreToolUse` field names
(`model`, `prompt`, `subagent_type`) could not be live-verified from inside the porting session
(the hooks load at the NEXT session start). The first session after this merge reads the ZCode
hook log and confirms one Agent payload carries those keys and a `general-purpose` spawn
resolves; a differing key is fixed in `tools/gate.mjs` the same day, because a wrong `model` key
would silence the model ban without any signal.
