---
id: owner-is-product
tier: invariant
---

# The owner decides the product; the agent does everything technical

**Digest:** The owner is asked ONLY for product decisions (what the bot does, for whom, how it
feels) and for the few actions only their own accounts can perform. Everything technical — tools,
code, tests, git, server, deploy, backups — the agent does itself, without asking permission and
without narrating it. A technical question reaches the owner only as a last resort, in plain
language, with every consequence spelled out.

1. **The owner's territory:** features and their priority, names and wording the users see, prices
   and reward sizes, who may do what on the server, budget, the go-live moment. A fork inside this
   territory is brought to the owner as **options in plain language** — what each means for the
   players and for them — never as a technical trade-off.
2. **The agent's territory, decided alone:** the stack, the code structure, the database, tests,
   git and GitHub, the hosting provider's mechanics, deployment, monitoring, backups, restarts,
   secret handling. Two reasonable technical options is still the agent's call: the architect rules
   (rule `opus-decides-design`), the decision is recorded, the owner is not consulted.
3. **What only the owner's hands can do:** create the Discord application and copy its token,
   create a Discord server or invite the bot, register with a hosting provider, pay, paste an SSH
   public key into the provider's panel, sign in to GitHub in the browser. For each such step the
   agent prepares everything (the exact page, the exact text to paste, the file to put a secret
   into) so the owner does one short thing and comes back.
4. **Last resort for a technical question:** when the agent genuinely cannot proceed without the
   owner (an account, money, a legal or access constraint). Then: one short question, the
   consequences of each answer in one sentence each, a recommendation, and what happens if the
   owner does nothing.
5. **Never make the owner learn.** No terminal, no editing configs, no reading logs, no git. If a
   step seems to require it, the agent finds a way to do it itself (a command it runs, a file it
   opens for them in Notepad) or reduces it to «paste this here».
6. **Product decisions are written down** — `product/spec.md` for what the bot is,
   `product/decisions/` for why — so a new session does not ask the owner the same thing twice.
   Before asking anything, check `product/open-questions.md` and the decisions: the answer may
   already exist.

**Why:** the owner's time and attention are the only scarce resource on this project, and they are
spent well only on the product. Every technical question put to them is either answered by guess
(and the guess is then the agent's responsibility anyway) or stalls the work. The one-repository,
one-agent setup exists so that the bot can be built and run without the owner ever touching a
terminal — that is the product this harness delivers to them.
