# 008. Matches in Discord — `/игры` panel, one-modal creation, a match panel behind the recruitment message, id-suffixed voice channels, a status-announcement marker, fake players for tests

**Status:** accepted (extends 004; amends 007 §1; one migration); §3, §6, §8 amended by 009; §5, §6, §7 amended by 010
**Date:** 2026-09-19
**Decided by:** architect (technical)

## Context
004 rules the state machine and `sync`. This record rules what 004 leaves open:
- how organisers reach the flow;
- how a creation form fits Discord's limits;
- where the organiser controls live;
- what the voice channels are named and allowed;
- how announcements survive replay;
- how one person tests a ten-seat match.

Facts: discord.js 14.27.0 (builders 1.14.1) supports `LabelBuilder` in modals with string, user
and channel selects and text inputs, at most 5 top-level components. A modal must be the first
response to an interaction, but the router defers everything (007 §1). `teamSize ≤ 10`, so a
roster is at most 20 players and fits one 25-option select.

## Decision
1. **Entry point: `/игры`**, an ephemeral panel, visible to everyone and refused by capability.
   - It opens for holders of `ACTIVITY_CREATE`, `MATCH_MANAGE_ANY` or `SETTINGS_MANAGE`.
   - It shows:
     - `➕ Создать игру` (`kp1:mnew`);
     - a select of open matches (`kp1:mopen`), newest first, at most 25, which opens that
       match's panel;
     - `⚙️ Настройки` (`kp1:mset`), only with `SETTINGS_MANAGE`.
   - There is no persistent panel message. `panelChannelId` stays reserved for the §7 admin
     panel.
   - Editing an activity is not in the first release. «Delete» is 004's cancel.
2. **Settings screen** (ephemeral). It has three controls:
   - a channel select for the default recruit channel (`kp1:ssrc`, text channels);
   - a channel select for the voice category (`kp1:svc`, categories);
   - a toggle for `autoMoveToVoice` (`kp1:smove`).

   On save, `GuildGateway` checks the bot's effective permissions there and names what is
   missing. For the recruit channel: View, Send, EmbedLinks, ReadHistory. For the category:
   View, Connect, ManageChannels, ManageRoles, MoveMembers. Reward amounts are shown here but
   not edited; editing them belongs to the §7 admin step.
3. **Creation is one modal, with no draft row.**
   - The router gets a new defer mode, `modal` (amends 007 §1). The router does not defer; the
     handler must call `showModal`. Before that it may do at most two indexed reads: rights,
     then games and settings. An error before `showModal` is answered with a private reply.
   - `kp1:mnew`:
     - If no voice category is set, it answers with the category select and a `Продолжить`
       button, so the organiser sets it once.
     - Otherwise it opens modal `kp1:mnewf`.
   - The modal holds five fields:
     1. Game: a string select of enabled games, the first 25 by `id`.
     2. Format: «как обычно для игры» (value 0, the default) or 2×2…10×10.
     3. Teams: «случайно» (the default) or «выбирает организатор».
     4. Title: an optional text input of at most 80 characters, default «Собираем игроков на
        матч».
     5. Recruit channel: a channel select, pre-filled with the default.
   - The voice category is always the settings value.
   - On submit:
     1. Rights, game, channel permissions and category are checked again.
     2. `matches.create` snapshots `rewards.resolveFor(gameId)` into `Match.rewards`, commits,
        and awaits `sync`.
     3. The organiser gets a link to the posted message.
   - The organiser does not type amounts. They are configuration, and the recruitment message
     shows them.
4. **The recruitment message** is an embed rendered only from the database by `sync`. Its edits
   are coalesced (§5).
   - It shows the game emoji, name and format, the title, the team mode, `👥 Участники: n/N`
     with mentions, and the rewards from the snapshot.
   - Buttons by status:
     - RECRUITING: `🎮 Участвовать` (`mjoin:<id>`), `❌ Покинуть игру` (`mleave:<id>`) and
       `⚙️ Управление` (`mpan:<id>`).
     - TEAMS_PENDING: `🔧 Распределить команды` (`mpan:<id>`).
     - IN_PROGRESS: the rosters with voice links, `🏁 Завершить матч` (`mfin:<id>`) and
       `⚙️ Управление`.
     - FINISHED or CANCELLED: the result or «отменён», with no buttons.
   - Join and leave defer as `update`. A success is confirmed with an ephemeral follow-up.
5. **The sync queue coalesces.**
   - Per match, at most one sync runs and at most one waits.
   - Handlers enqueue a sync and do not wait for it. Create is the exception.
   - `sync` never bumps `version`. It records the version it read at its start with
     `SET syncedVersion = $v WHERE syncedVersion < $v`.
   - It writes channel ids with `WHERE voiceChannelXId IS NULL OR = $old`.
6. **The match panel** is ephemeral. It opens from the recruitment message or from `/игры`.
   - Rights come from `permissions.canManageMatch(member, match)`: the creator, or a holder of
     `MATCH_MANAGE_ANY`.
   - **Services enforce rights themselves.** They take `actor: MemberFacts`, so a forged
     custom_id cannot bypass them.
   - Panel parts:
     - **Remove a player:** a string select of participants (`mrm:<id>`). There is no version
       and no confirmation; the guard is the status plus the participant existing.
     - **Team picker** (TEAMS_PENDING): one string select «🔵 Команда A» (`mteam:<id>`), with
       `min = max = teamSize` and the current A players as defaults.
       - On submit, one guarded transaction bumps `version`, puts the chosen players in team A
         and the rest in team B.
       - `✅ Подтвердить команды` is `mtok:<id>:<v>`.
     - **Finish:** exactly as in 004 §4. The MVP select lists participants that have a team.
     - **Cancel:** `mcan:<id>:<v>`, then `mccf:<id>:<v>`.
7. **Voice channels.**
   - **Names:** `🔵 Команда A · #<matchId>` and `🔴 Команда B · #<matchId>`. The suffix tells
     concurrent matches apart and makes `ensure` idempotent: it tries the stored id, then the
     exact name in the category, then creates the channel.
   - **Overwrites** use `permissionOverwrites.set`, a full replace, so a replay converges:
     - `@everyone`: deny View and Connect;
     - the bot's member: allow View, Connect, ManageChannels and MoveMembers;
     - the creator and every role with `MATCH_MANAGE_ANY`: allow View and Connect;
     - from IN_PROGRESS, the team's members who have not left and are not fake: allow View and
       Connect.

     Only View and Connect are granted, because those are the permissions the bot itself holds.
     Speak is inherited.
   - **Channels wanted by status:**
     - RECRUITING: none, so a reopen deletes them;
     - TEAMS_PENDING: channels only the organiser can see;
     - IN_PROGRESS: team channels;
     - FINISHED or CANCELLED: none.

     A delete that gets «Unknown Channel» counts as done.
   - **Orphans.** A channel is an orphan when all three hold:
     - its name matches `^(🔵 Команда A|🔴 Команда B) · #(\d+)$`;
     - it sits in a managed category: the settings category, or the category of a match that
       is not terminal or ended in the last 7 days;
     - no non-terminal match holds its id.

     Orphans are deleted by the startup recovery and after each terminal sync. This refines
     004 §6's orphan-by-name rule.
8. **Announcements: a new column `Match.announcedStatus MatchStatus?`.**
   - When the status is TEAMS_PENDING, IN_PROGRESS, FINISHED or CANCELLED and differs from
     `announcedStatus`, sync posts one message in the recruit channel, then sets the column.
   - What each announcement does:
     - TEAMS_PENDING: pings the creator.
     - IN_PROGRESS: pings the players with their teams. If `autoMoveToVoice` is on, it first
       moves the players who are connected to voice.
     - FINISHED: posts the result card: game, winner, rosters, MVP, paid and withheld amounts.
     - CANCELLED: pings the players.
   - A reopen sets `announcedStatus` to NULL.
   - A crash between posting and saving can duplicate one announcement; that is accepted.
   - There are no DMs and no ping on each join.
9. **A player leaving the server during IN_PROGRESS.** One status-guarded update sets
   `leftServerAt` **and bumps `version`**. The payout set has changed, so an open finish panel
   correctly goes stale. At startup, `reconcileMembership` runs before the syncs and skips fake
   ids.
10. **Fake players for tests.**
    - Fake ids start with `0` and are 17 digits long. Discord never issues such ids.
    - Every gateway call path checks `isFakeUserId(id)`. Mentions render as «🧪 Тестовый
      игрок k». Overwrites, moves and membership checks skip fake players.
    - The `🧪 Добавить тестовых игроков` button (`mtest:<id>`) is shown and runs only when
      `NODE_ENV !== 'production'` and the presser is the guild owner. Both the handler and the
      service check this.
    - It fills the match to `capacity − 1` through `matches.join`, the real path, so the
      owner's own press closes the roster.
    - Fake players are paid like real ones. This only happens in the dev database.
11. **Migration:** the new `announcedStatus` column, and `CHECK ("amount" >= 0)` on `RewardRule`,
    because a negative reward would debit players through `economy.move`.
12. **Interfaces** (modules, with no discord.js):
    - `GamesService`: `listEnabled()`, `get(id)`.
    - `RewardsService.resolveFor(gameId)`: a game's own rule overrides the default rule, and a
      missing rule counts as 0.
    - `PermissionsService.canManageMatch(member, {createdById})`.
    - `MatchesService`:
      - `create(actor, {gameId, teamSize|0, teamMode, title|null, recruitChannelId}) →
        {matchId}`;
      - `get(id) → MatchSnapshot` and `listOpen(limit)`;
      - `join(id, userId)` and `leave(id, userId)`;
      - `removeParticipant(actor, id, userId)`;
      - `assignTeamA(actor, id, userIds) → version` and `confirmTeams(actor, id, v)`;
      - `finish(actor, {id, v, winner, mvpUserId}) → {paid[], withheld[]}`;
      - `cancel(actor, id, v)`;
      - `memberLeft(userId)` and `reconcileMembership()`;
      - `addTestPlayers(actor, id)`;
      - `sync(id)`, `needingSync()` and `cleanupOrphans()`.
    - `GuildGateway` adds:
      - `renderMatchMessage(snapshot, channelId, messageId|null) → messageId`, which reposts on
        Unknown Message;
      - `ensureVoiceChannel(spec) → id` and `deleteChannel(id)`;
      - `moveMembers(userIds, channelId)`, best effort;
      - `announce(channelId, snapshot, status)`;
      - `presentMembers(ids) → Set`;
      - `listVoiceChannels(categoryIds)`;
      - `checkRecruitChannel(id)` and `checkVoiceCategory(id) → missing[]`.

## Rejected
- **A persistent panel message.** It is more public state to sync and hide, and the panel is
  per organiser anyway.
- **A multi-step ephemeral wizard or a draft row.** One modal holds everything, and a draft
  would need expiry and cleanup.
- **Organiser-typed amounts.** Organisers could print KP. It is a product question (Q8).
- **Two per-team pickers or a select per player.** Both allow a player on both teams, or more
  than 5 rows. One exact-size A-select defines team B.
- **004's exact names, `Команда A`/`B`.** Two concurrent matches would show identical channels,
  and a crashed create could not be found again.
- **Separate `movedAt` and `resultMessageId` columns.** One `announcedStatus` covers all four
  announcements.
- **Driving the flow with a second bot login from a script.** The same token on two gateways
  receives every interaction twice.
- **A leave-server update without a version bump.** A finish panel would confirm amounts that
  are no longer true.

## Consequences
- The router gains the `modal` mode. A slow database can then fail a modal open with
  «interaction failed»; the organiser sees it and can retry.
- Sync is more code, but it converges from any crash point.
- Watch:
  - `participantCount = count(Participant)` after every roster test;
  - fake ids never reaching the gateway;
  - the bot's permissions in the category, checked when settings are saved and at create.
- The product forks this step raises are Q8–Q12 in `open-questions.md`, and their meanwhile
  behaviour is built.
