# product/decisions/ — decision records

One file per decision, `NNN-<slug>.md`, numbered in order of writing. The filename is the index;
there is no separate list. A decision is written BEFORE the code that implements it (rule
`opus-decides-design`) and is never edited to say something else: a change is a new record that
supersedes the old one and says so in both.

## Shape

```markdown
# NNN. Title — the decision in one line

**Status:** accepted | superseded by NNN
**Date:** YYYY-MM-DD
**Decided by:** owner (product) | architect (technical)

## Context
Two to five sentences: the fork, the facts that forced a choice.

## Decision
What was chosen. Numbered where there are several parts.

## Rejected
Each alternative in one line with why it lost. A decision without its discarded alternatives is
unreviewable later.

## Consequences
What becomes easier, what becomes harder, what must be watched.
```

## Two kinds

**Product decisions** (`Decided by: owner`) — an answer to an open question, a change of scope, a
price, a right. Written by the agent from the owner's words in chat, in the owner's terms, and
mirrored into `product/spec.md` in the same pass.

**Technical decisions** (`Decided by: architect`) — the stack, the state model, the recovery
scheme, the shop-item abstraction, a deletion. Written by the architect's ruling; the pull
request that implements it names the record.

Target ≤ 600 words. Facts that rot (prices, versions, addresses) go in runbooks and are linked.
