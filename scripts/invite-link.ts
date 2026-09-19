// `npm run invite-link` — prints the bot's invite URL (runbooks/discord-app-setup.md §3).
// Reads .env for the token but prints ONLY the URL: the client id is public, the token is not.
import { config } from 'dotenv';
import { clientIdFromToken, inviteUrl } from '../src/discord/invite.js';

config({ quiet: true });

const explicit = process.env.DISCORD_CLIENT_ID?.trim();
const clientId = explicit || clientIdFromToken(process.env.DISCORD_TOKEN ?? '');

if (!clientId) {
  console.error('No application id: DISCORD_TOKEN in .env is empty or not a bot token (runbooks/discord-app-setup.md §2).');
  process.exit(1);
}
console.log(inviteUrl(clientId));
