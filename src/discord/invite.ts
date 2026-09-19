// The invite link and the ids the owner never has to copy (runbooks/discord-app-setup.md §3).
import { PermissionFlagsBits } from 'discord.js';

/** What the bot needs on the server; the integer goes into the invite URL. */
export const INVITE_PERMISSIONS: bigint =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.Connect;

/**
 * The application id is the first dot-separated segment of a bot token, base64-encoded.
 * Returns null when the token does not have that shape. Never logs the token.
 */
export function clientIdFromToken(token: string): string | null {
  const first = token.trim().split('.')[0];
  if (!first) return null;
  const decoded = Buffer.from(first.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return /^\d{17,20}$/.test(decoded) ? decoded : null;
}

export function inviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: INVITE_PERMISSIONS.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString().replace(/\+/g, '%20')}`;
}
