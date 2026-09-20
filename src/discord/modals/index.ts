// Modal routes by custom_id action (decision 002 §4). The admin KP adjust modal (003 §3) comes later.
import type { ModalSubmitInteraction } from 'discord.js';
import type { ComponentRoute } from '../router.js';
import { createMatchModal } from './createMatch.js';
import { clanRenameModal, grantClanModal, newClanModal, roomRenameModal } from './shop.js';

export const modals: ReadonlyMap<string, ComponentRoute<ModalSubmitInteraction>> = new Map([
  ['mnewf', createMatchModal],
  ['shclan', newClanModal],
  // /выдать-товар (decision 024)
  ['shgcl', grantClanModal],
  ['clrenf', clanRenameModal],
  ['rmnamef', roomRenameModal],
]);
