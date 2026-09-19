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

Currency name `KP Coin`, short `KP`, shown as `💰 1 250 KP`. Every user has a balance.

A user can: see their balance and profile, see their operation history, buy in the shop, receive
rewards, earn KP from game activity. Commands `/баланс`, `/магазин`, `/профиль` (Russian names
allowed).

Every KP movement is recorded: who, how much, kind, source, description, time, and the match or
purchase it relates to. Example lines: `+100 KP — победа в CS2`, `+50 KP — MVP`,
`-500 KP — доступ к GIF`. The history is the audit trail of the economy.

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

## 5. Finishing a match, MVP, rewards

The organiser opens the match panel, presses `🏁 Завершить матч`, chooses the winner
(🔵 A / 🔴 B / 🤝 ничья), then picks the MVP from the match's players (`⭐ Выберите MVP матча`).
Rewards are paid automatically — participation, win, MVP, extra bonuses — with amounts set in
configuration, never in code (examples from the brief: win +100, participation +25, MVP +50).

The bot posts the result: game, winner, both rosters, MVP, the rewards paid. Every payment is a
history line.

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
text, clear errors, no walls of text. Player-facing wording follows rule `plain-language` §8.

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

Last verified: 2026-09-19 (derived from the owner's brief; no product decision changed yet).
