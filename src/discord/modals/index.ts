// Modal routes by custom_id action (activity form, admin KP adjust — decision 003 §3). None yet.
import type { ModalSubmitInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';

export const modals: ReadonlyMap<string, ComponentRoute<ModalSubmitInteraction>> = new Map();
