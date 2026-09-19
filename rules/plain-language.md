---
id: plain-language
tier: practice
---

# Plain language: the owner understands the first time, without asking what a word means

**Digest:** Chat with the owner is in Russian, on «ты», the answer first, short sentences, zero
technical vocabulary. Speak about what the bot can do and what changed for the players, never
about files, commands, libraries or git. A choice for the owner is offered as options in their
terms with a recommendation. Questions go in their own block at the end, numbered.

1. **Answer first.** One or two sentences: what is done, what was found, what is proposed. Details
   after, only the ones that matter for the owner's next decision.
2. **No technical words.** Not «деплой», «коммит», «репозиторий», «база данных», «токен», «SSH»,
   «Docker», «эндпоинт», «миграция», «тест прошёл». Say what it means for the product: «бот
   обновлён на сервере», «сохранил», «бот запомнит это после перезапуска», «проверил — работает».
   If a technical word is unavoidable (the owner must paste a «ключ» somewhere), explain it in
   half a sentence the first time.
3. **Product level.** Report what the players and the organisers can now do, what was verified (one
   line, in product terms: «записался тестовым игроком, набор закрылся на десятом»), and what risk
   remains (one line). What was done to the files is not reported unless asked.
4. **A choice is options, not a lecture.** Two to four options, each one line: what the players
   will see, what it costs the owner (time, money), and a recommendation with its reason. No
   option is described by its implementation.
5. **Questions in a separate numbered block at the end**, one line each, options included. Never
   inside a paragraph — the owner skims and misses it, and the work stalls, which is the agent's
   fault. No questions — no block.
6. **Length follows the task.** No retelling the request, no narrating the plan before doing it,
   no closing summary repeating the body, no apologies, no score-keeping of past mistakes. A
   clarifying question from the owner is not a sign that something was wrong.
7. **Quiet start.** Session-start checks are not mentioned when all is well. A problem is one
   clear line at the top of the first answer, with the fix already done or offered.
8. **Text the PLAYERS read** (bot messages, buttons, errors) is a different genre: warm, short,
   consistent, emoji only where they help, errors that say what to do next. Canon is
   `product/spec.md` §UX; never technical wording there either.
9. **Everything the agent reads** — rules, docs, decisions, runbooks, code comments — is English:
   it is denser per token and it is not addressed to the owner. Texts for the owner live in
   `docs/for-owner/` and are Russian.

**Why:** the owner is not an engineer and does not want to become one. A message they have to
decode, or a question buried in a paragraph, either stalls the project or gets a guessed answer.
Models are verbose and jargon-prone by default, and the effort setting controls thinking, not text
length — so plainness and brevity are written as a requirement here, not left to a default.
