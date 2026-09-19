# KiberPride Bot — the product canon

What the bot is, in the owner's terms. The source is the owner's brief of 2026-09-19, stripped of
its implementation guesses (folder layouts, table lists, stack hints — those belong to the
architect and to `product/decisions/`). This file changes only by a product decision of the
owner; open forks are in [open-questions.md](open-questions.md).

## Purpose

A Discord bot for the official KiberPride gaming server that joins two systems: the **KP Coin
economy** and **game recruitment with automatic team formation**. It must feel like a finished
KiberPride product, not a set of commands: buttons, menus and forms for everything, minimal
typed commands, one consistent visual style, clear errors. Built to grow: new reward kinds, shop
goods, games, statistics and mechanics are added as modules without rewriting the core.

## Roles on the server

Regular user · organiser (host) · moderator · administrator · owner/developer. Rights are checked
in one place; what each role may do is configuration, not code.

## 1. Economy — KP Coin

Currency name `KP Coin`, shown in full after every amount: `💰 1 250 KP Coin` (decision 005).
Every user has a balance.

A user can: see their balance and profile, see their operation history, buy in the shop, receive
rewards, earn KP from game activity. Commands `/баланс`, `/магазин`, `/профиль` (Russian names
allowed).

Every KP movement is recorded: who, how much, kind, source, description, time, and the match or
purchase it relates to. Example lines: `+100 KP Coin — победа в CS2`, `+50 KP Coin — MVP`,
`-500 KP Coin — доступ к GIF`. The history is the audit trail of the economy.

Planned later, so the design must leave room: daily reward, activity bonuses, tasks, achievements,
transfers between users, leaderboards, cases, more KP sources.

## 2. Shop

Sells **Discord permissions** first, not roles: «доступ к изображениям» (send images in a given
channel or category) and «доступ к GIF». Buying grants the permission through a role; the number
of such goods must grow easily.

A good has: name, description, price, kind, what it grants, validity period, on/off switch. All
of it is configuration.

**Personal roles are NOT in scope now**, but the shop must be able to sell later: a personal or
custom role, a role colour, a temporary role, a cosmetic item, access to a feature. So goods are
an abstract kind with a handler per kind.

## 3. Game activities and recruitment

An organiser creates an activity from a control panel («🎮 Управление игровыми активностями»:
create, edit, delete, active games, settings). Creating opens a form: game (CS2, Valorant, Dota 2,
Мафия, …), activity title, number of players, team format, reward, duration or settings if
needed, the recruitment channel, the category for voice channels.

The bot then posts the recruitment message, e.g. «🎮 CS2 — 5×5 · Собираем игроков на матч ·
👥 Участники: 7/10» with buttons `🎮 Участвовать` / `❌ Покинуть игру`. Joining adds the player,
updates the counter, notifies if configured, and a player cannot join twice.

**As built (decisions 008, 009):**
- The control panel is the command **`/игры`**: `➕ Создать игру`, the open matches, `⚙️ Настройки`.
  It opens for organisers, match managers and settings managers; others are politely refused.
- **Settings** on that screen: the default recruit channel, the category for team voice channels,
  whether players are moved into their team channel at the start, and after how many hours an
  unfilled recruitment closes by itself (**3 hours by default**; 0 = never; choices 1, 2, 3, 6,
  12, 24). Reward amounts are shown there but changed only in the future admin panel.
- **Creation** is one form: game, format («как обычно для игры» or 2×2…10×10), teams (random or
  picked by the organiser), an optional title, the recruit channel. The voice category is always
  the one from the settings. The organiser never types amounts.
- The recruitment message shows the rewards; the organiser's `⚙️ Управление` panel lets them remove
  a player, mark the match **⭐ Особый матч ×2** while recruiting (every reward doubled; the message
  then says «⭐ Особый матч — награды ×2»), and cancel with a confirmation.
- **One started match at a time:** a player in a match that has started cannot join another
  recruitment until it ends («Ты сейчас в матче — дождись его конца…»). Several open sign-ups at
  once are allowed.
- An unfilled recruitment older than the timeout is **cancelled automatically**; the players are
  pinged and the log channel says «набор закрыт по времени».
- For tests only (never on the live server): the guild owner sees `🧪 Добавить тестовых игроков`,
  which fills the match to one seat short, so one person can play a ten-seat match through.

## 4. Full roster and teams

When the limit is reached (10/10) the recruitment closes and two voice channels appear:
🔵 `Команда A`, 🔴 `Команда B`. First format 5×5; the design supports 2×2 … 6×6 and beyond.

Two team modes. **Automatic:** random split, then the message shows the rosters, players are
notified and, if configured, moved into their voice channel. **Manual:** the organiser presses
`🔧 Распределить команды`, picks who goes where in a convenient picker, confirms; the bot
activates the channels and publishes the rosters.

Voice channels are visible and usable only by their team; the organiser sees both. After the
match the temporary channels are deleted automatically; later options: keep for a while, reuse
existing channels.

**As built (decision 008):** the channels are named `🔵 Команда A · #<номер матча>` and
`🔴 Команда B · #<номер матча>`, so two matches at once never look alike. They appear when the
roster closes (visible to the organisers only while teams are being picked), open to each team
when the match starts, and are deleted when it ends or is cancelled. Manual picking is one list:
the organiser chooses exactly the players of 🔵 A, everyone else is 🔴 B, then `✅ Подтвердить
команды`. Pings: the organiser when manual picking is due, the players when the match starts and
when it is cancelled; no ping on each join, no private messages.

## 5. Finishing a match, MVP, rewards

The organiser opens the match panel, presses `🏁 Завершить матч`, chooses the winner
(🔵 A / 🔴 B / 🤝 ничья), then picks the MVP from the match's players (`⭐ Выберите MVP матча`).
Rewards are paid automatically — participation, win, MVP, extra bonuses — with amounts set in
configuration, never in code (examples from the brief: win +100, participation +25, MVP +50).

The bot posts the result: game, winner, both rosters, MVP, the rewards paid. Every payment is a
history line.

**As built (decision 009):** MVP is optional — the MVP list starts with «Без MVP»; then no MVP
reward is paid and the result says «MVP не выбран». On a draw the draw reward (0 by default, so
nothing extra) goes to both teams. A special match pays every reward ×2. The amounts are fixed
when the match is created (or switched to ×2), so a settings change never alters what an open
match promised. A player who left the server during the match keeps their place on the roster,
but their rewards are held back and written to the log channel so they can be paid by hand later
— exactly once.

## 6. Guarantees the players rely on

No double join; no join after the roster closed; no removing a player without rights; no
finishing a match twice; no paying a reward twice; no MVP who did not play; no winner before the
teams exist. A player leaving the server is handled. A bot restart does not break active
recruitments or matches — they continue with their buttons working. Concurrent button presses do
not corrupt the roster. Important actions are logged, ideally to a dedicated Discord log channel.

## 7. Admin panel

One control centre («⚙️ KiberPride Bot»): Economy (balances, shop, goods, rewards,
transactions) · Games (create, active, finished, settings) · Matches (active, teams, pay a
reward, finish) · Settings (channels, categories, roles, team sizes, rewards, logs). Everything
configurable lives in configuration or the database, never hard-coded.

## 8. UX

Neat embeds, understandable names, one style, emoji only where they help, minimum technical
text, clear errors, no walls of text. **Every message a player sees is an embed in the brand
colour `#226de6`** (decision 012); a message that must ping carries only the mentions as text. Player-facing wording follows rule `plain-language` §8.

## 9. Growth (not now, but the shape must allow it)

Economy: daily bonus, achievements, quests, leaderboard, KP transfers, cases, auction, activity
bonuses. Shop: personal and custom roles, colours, temporary roles, channel access, cosmetics.
Games: more games and formats, ranked matches, tournaments, statistics, ELO, series, seasons.
Profile: balance, matches played, wins, losses, MVP count, per-game stats, achievements.

## 10. First release (MVP)

**Economy:** KP Coin, balance, history, the shop, buying image access and GIF access, granting
and revoking the matching Discord permission through roles.

**Recruitment:** create an activity, the recruitment channel, join button, counter and limit,
automatic close, two voice channels, random teams, manual teams, finish, winner, MVP, KP payout,
match history.

Nothing from §9 is built in the first release; the extension points are left clear and named.

---

Last verified: 2026-09-20 (§3–§5 «as built» notes added with the matches step, decisions 008 and
009 — checked by the automated suite, not yet walked on the test server; earlier: amounts shown
as «KP Coin», decision 005; test server first, decision 006).
