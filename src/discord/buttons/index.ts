// Button routes by custom_id action (decision 002 §4). A new button is one route plus one line.
import type { ButtonInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';
import { autoMoveButton, newGameButton, settingsButton } from './games.js';
import { historyButton } from './history.js';
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

export const buttons: ReadonlyMap<string, ComponentRoute<ButtonInteraction>> = new Map([
  ['hist', historyButton],
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
]);
