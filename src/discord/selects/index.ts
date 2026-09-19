// Select-menu routes by custom_id action (team picker, MVP choice — decision 004). None yet.
import type { AnySelectMenuInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';

export const selects: ReadonlyMap<string, ComponentRoute<AnySelectMenuInteraction>> = new Map();
