// Every slash command of the bot. Registered in the one guild at start (src/discord/client.ts).
import type { CommandRoute } from '../router.js';
import { balanceCommand } from './balance.js';
import { gamesCommand } from './games.js';
import { profileCommand } from './profile.js';

const all: CommandRoute[] = [balanceCommand, profileCommand, gamesCommand];

export const commands: ReadonlyMap<string, CommandRoute> = new Map(all.map((c) => [c.definition.name, c]));
export const commandDefinitions = all.map((c) => c.definition);
