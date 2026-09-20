// Button routes by custom_id action (decision 002 §4). A new button is one route plus one line.
import type { ButtonInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';
import { autoMoveButton, newGameButton, settingsButton } from './games.js';
import { historyButton, historyPageButton } from './history.js';
import {
  cancelButton,
  confirmCancelButton,
  confirmFinishButton,
  confirmTeamsButton,
  finishButton,
  joinButton,
  leaveButton,
  panelButton,
  specialButton,
  testPlayersButton,
  winnerButton,
} from './matches.js';
import {
  buyButton,
  clanButton,
  clanLeaveButton,
  clanRenameButton,
  dailyButton,
  devExpireButton,
  devTopUpButton,
  enableGoodButton,
  myPurchasesButton,
  newClanButton,
  revokeButton,
  roomButton,
  roomLockButton,
  roomRenameButton,
  settingsBackButton,
  shopSettingsButton,
} from './shop.js';

export const buttons: ReadonlyMap<string, ComponentRoute<ButtonInteraction>> = new Map([
  ['hist', historyButton],
  ['hpg', historyPageButton],
  ['mnew', newGameButton],
  ['mset', settingsButton],
  ['smove', autoMoveButton],
  ['mjoin', joinButton],
  ['mleave', leaveButton],
  ['mpan', panelButton],
  ['mfin', finishButton],
  ['mwin', winnerButton],
  ['mcfm', confirmFinishButton],
  ['mcan', cancelButton],
  ['mccf', confirmCancelButton],
  ['mtok', confirmTeamsButton],
  ['mspc', specialButton],
  ['mtest', testPlayersButton],
  // Shop and earnings (decision 014 §10, §12)
  ['shbuy', buyButton],
  ['shcnew', newClanButton],
  ['clan', clanButton],
  ['clren', clanRenameButton],
  ['clleave', clanLeaveButton],
  ['room', roomButton],
  ['rmname', roomRenameButton],
  ['rmlock', roomLockButton],
  ['mybuy', myPurchasesButton],
  ['dexp', devExpireButton],
  ['dtop', devTopUpButton],
  ['daily', dailyButton],
  ['sshop', shopSettingsButton],
  ['ssback', settingsBackButton],
  ['shen', enableGoodButton],
  // /отозвать (decision 023)
  ['rvk', revokeButton],
]);
