// Button routes by custom_id action (decision 002 §4). A new button is one file plus one line.
import type { ButtonInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';
import { historyButton } from './history.js';

export const buttons: ReadonlyMap<string, ComponentRoute<ButtonInteraction>> = new Map([['hist', historyButton]]);
