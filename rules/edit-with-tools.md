---
id: edit-with-tools
tier: practice
---

# Files are edited with the editing tools; the shell is for commands

**Digest:** A file in this repository is changed with Edit or Write, never with `sed -i`, a
heredoc redirected into a file, or a one-off editor script — the gate refuses those in every
mode, including bypass-permissions. The shell runs commands: npm, git, gh, ssh, docker, the
project's own scripts.

1. **Why not the shell on this machine:** Windows, CRLF line endings, Russian text in owner-facing
   files and in bot copy. `sed` and heredocs mangle encodings and line endings silently, and the
   diff the tools show is the only review the change gets.
2. **Bypass-permissions mode does not change this.** The harness suggests shell edits in that
   mode as a default; it does not apply here. The gate in `tools/gate.mjs` refuses `sed -i`,
   `perl -i`, `> file` / `>> file` heredocs into repository files, and `node -e` / `python -c`
   writes. Last-resort escape: `# SHELL-EDIT: <reason>` in the same command, which the report
   names.
3. **Reading** is free with any tool. **Bulk transforms** (a rename across many files) are a
   script run on ONE file first, the diff checked, then the rest.
4. **Remote files on the server** are edited over SSH per the runbook, since no editing tool
   reaches them; the runbook's commands are the ones used, and the file is read back after.

**Why:** the previous project lost hours to shell edits that turned Russian text into garbage and
flipped every line ending in a file, producing an unreadable diff. The editing tools show exactly
what changed, keep the encoding, and are the habit the gate enforces.
