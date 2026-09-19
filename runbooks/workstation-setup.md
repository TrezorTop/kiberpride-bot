# Workstation setup — the owner's Windows machine

Run by the agent in the first session (`/init-project` step 1). Everything is installed with
`winget` from the shell; the owner is not asked to install anything. Restart the shell (or the
session) after installs so `PATH` is refreshed; a tool that is still «not found» after that is
found by its absolute path under `%LOCALAPPDATA%\Programs` or `%ProgramFiles%`.

## 1. Check what is there

```bash
git --version; node --version; npm --version; gh --version; docker --version; ssh -V
```

## 2. Install what is missing

```bash
winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements
winget install --id GitHub.cli -e --accept-package-agreements
winget install --id Docker.DockerDesktop -e --accept-package-agreements
```

OpenSSH client ships with Windows 10/11; if `ssh` is missing:
`Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0` in an elevated PowerShell.

Add `--silent` to each winget install so no installer window waits for a click. Windows may still
show one admin prompt («Разрешить этому приложению…?»); warn the owner to press «Да».

Docker Desktop needs WSL2 and one reboot on a fresh machine. If `wsl --status` says WSL is not
installed, run `Start-Process wsl.exe -ArgumentList '--install','--no-distribution' -Verb RunAs
-Wait` (one admin prompt). `wsl --status` then complains that virtualization is off until the
reboot. `VirtualizationFirmwareEnabled = False` together with `HypervisorPresent = True` is
normal, and it went away after the reboot on the owner's machine. Do the reboot AFTER the
scaffold is written: a background helper dies with it. Leave a note in
`docs/for-owner/status.md` first. **OWNER:** the reboot, and the Docker Desktop first-start
window. Accepting its terms is the owner's click; the agent does not click through terms.
Tell the owner in one sentence why the machine restarts.

## 3. Git identity

```bash
git config --global user.name "<owner's Discord name or first name>"
git config --global user.email "<the email they use on GitHub>"
git config --global core.autocrlf false
```

Ask the owner for the name only if it is not derivable; the email is the GitHub account's.

## 4. GitHub sign-in (once)

First check `gh auth status` and `gh api repos/<owner>/<repo> --jq .permissions.push`. On the
owner's machine, `gh` was already signed in to an account with push rights, so this step did
not happen.

The repository is public, so reading needs nothing. The first `git push` opens a browser window
from Git Credential Manager. **OWNER:** signs in to GitHub in that window and clicks «Authorize».
Prepare it: say «сейчас откроется окно, войди в GitHub и нажми разрешить», then run the push.
`gh auth login --web` is the alternative for `gh pr create`; it prints a code the owner enters
on the page it opens — same one sentence.

## 5. Verify

`node tools/preflight.mjs` prints nothing about a missing toolchain; `docker run --rm
hello-world` succeeds; `gh auth status` is logged in.

## 6. Local databases, the gate, a local run

Node may be missing from the agent's shell `PATH` right after install: prepend
`C:\Program Files\nodejs` (and `C:\Program Files\Docker\Docker\resources\bin` for docker).

```bash
npm ci && npx prisma generate      # after every pull that touched package.json or prisma/
npm run db:up                      # docker-compose.dev.yml: postgres :5432 (dev), postgres-test :5433 (tests)
npm run check                      # typecheck + lint + unit + db tests; the db tests FAIL without postgres-test
npx prisma migrate deploy && npm run db:seed   # the dev database, once and after new migrations
npm run dev                        # the bot against the test Discord server
```

The preflight says in one line when Docker Desktop is installed but not running.

---

Last verified: 2026-09-19. Walked on the owner's machine (Windows 11 Pro):
- Git was already installed.
- Node 24 LTS, gh 2.101 and Docker Desktop 4.91 were installed by winget.
- WSL was installed and the machine rebooted.
- `npm run check` passed, and `npm run dev` served the test server.
- The git identity was already set; `core.autocrlf false` was applied.
