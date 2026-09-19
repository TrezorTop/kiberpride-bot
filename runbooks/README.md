# runbooks/ — step-by-step procedures

Each runbook is a sequence the agent executes itself. The owner's hands appear only in steps
marked **OWNER:** and each such step is reduced to one paste or one click, explained in Russian
in chat at that moment (rule `owner-is-product` §3).

| Runbook | When |
|---|---|
| [workstation-setup.md](workstation-setup.md) | the owner's Windows machine: toolchain, GitHub sign-in, Docker Desktop |
| [discord-app-setup.md](discord-app-setup.md) | the Discord application, the token into `.env`, intents, the invite link, the test server; token rotation |
| [server-setup.md](server-setup.md) | choosing and buying the VPS, the SSH key, first login, hardening, Docker |
| [deploy.md](deploy.md) | shipping a version to the server and reading the live signal |
| [backup-restore.md](backup-restore.md) | database dumps, the nightly job, a restore check |

A runbook that disagrees with the machine or the server is fixed in the same pass (rule
`work-order-and-doc-sync` §6). Addresses, user names and anything sensitive stay out of the
runbooks: they live in `deploy/inventory.local` (ignored by git) and in `.env`.
