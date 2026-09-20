// Every slash command of the bot. Registered in the one guild at start (src/discord/client.ts).
import type { CommandRoute } from '../router.js';
import { balanceCommand } from './balance.js';
import { bonusCommand } from './bonus.js';
import { gamesCommand } from './games.js';
import { grantCommand } from './grant.js';
import { grantGoodCommand } from './grantGood.js';
import { profileCommand } from './profile.js';
import { revokeCommand } from './revoke.js';
import { rightsCommand } from './rights.js';
import { roomCommand } from './room.js';
import { shopCommand } from './shop.js';
import { shopSettingsCommand } from './shopSettings.js';

const all: CommandRoute[] = [
  balanceCommand,
  profileCommand,
  shopCommand,
  roomCommand,
  bonusCommand,
  gamesCommand,
  shopSettingsCommand,
  rightsCommand,
  grantCommand,
  revokeCommand,
  grantGoodCommand,
];

export const commands: ReadonlyMap<string, CommandRoute> = new Map(all.map((c) => [c.definition.name, c]));
export const commandDefinitions = all.map((c) => c.definition);
