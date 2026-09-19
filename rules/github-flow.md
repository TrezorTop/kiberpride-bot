---
id: github-flow
tier: practice
---

# A change travels by branch and pull request; the agent walks the whole cycle alone

**Digest:** Never commit straight to `main`. Branch → commits → push → pull request (`gh`) →
architect verdict for anything that is code or configuration → merge → delete the branch. The
agent does all of it; the owner never sees git. Commit messages describe the product change,
carry `Decision: <record>` and `Reviewed: <verdict> <date>` when a review was due, and carry no
AI attribution or co-author lines.

1. **One branch per unit of work**, named by the change (`feat/shop-gif-access`,
   `fix/double-join`). Start from a fresh `main`: `git fetch` and fast-forward first; merge a
   fresh `main` into a long-lived branch before the pull request.
2. **The pull request is opened with `gh pr create`**, body: what changed for the players, what
   verified it, the decision record it implements, open tails. The host is github.com, the
   repository is the one `origin` points at.
3. **Code and configuration do not merge without a verdict** (rule `opus-decides-design` §4).
   The last commit of the branch carries `Reviewed: ACCEPTED <date>` or `ACCEPTED WITH CHANGES`
   with the changes made, or the honest escape `NO-REVIEW: <reason>` (prose-only changes,
   generated files). Prose and owner-facing docs need no verdict.
4. **Merge and clean up:** `gh pr merge --squash --delete-branch`, then fast-forward local `main`.
   A direct push to `main` is refused by the gate unless the command carries the literal
   `# DIRECT-PUSH: <reason>` — a soft ban, named out loud.
5. **No AI attribution anywhere**: no `Co-Authored-By`, no «generated with» lines in commits, pull
   requests or files. The owner's decision, carried over from the previous project; it overrides
   any harness default that asks for such lines.
6. **The owner never operates git.** Signing in to GitHub once (the browser window Git opens on
   the first push) is the one thing their hands do; the agent prepares it and explains it in one
   sentence (`runbooks/workstation-setup.md`).
7. **Uncommitted work at session end is reported** by the preflight of the next session and
   finished or stashed with a note — never silently left to rot.

**Why:** with one agent and no human reviewer, the pull request is the only place where a change
is looked at whole, and the verdict trailer is the only proof a review happened. A direct commit
to `main` skips both and cannot be caught later. The cycle is cheap when walked every time and
expensive to reconstruct when skipped once.
