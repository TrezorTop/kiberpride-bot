// Select-menu routes by custom_id action (decision 002 §4).
import type { AnySelectMenuInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';
import { mvpSelect, openMatchSelect, removePlayerSelect, teamPickerSelect } from './matches.js';
import { recruitChannelSelect, recruitTimeoutSelect, voiceCategorySelect } from './settings.js';

export const selects: ReadonlyMap<string, ComponentRoute<AnySelectMenuInteraction>> = new Map([
  ['mopen', openMatchSelect],
  ['mrm', removePlayerSelect],
  ['mteam', teamPickerSelect],
  ['mmvp', mvpSelect],
  ['ssrc', recruitChannelSelect],
  ['svc', voiceCategorySelect],
  ['stmo', recruitTimeoutSelect],
]);
