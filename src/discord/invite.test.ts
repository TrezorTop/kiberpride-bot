import { describe, expect, it } from 'vitest';
import { clientIdFromToken, INVITE_PERMISSIONS, inviteUrl } from './invite.js';

// A made-up token of the real shape: base64(application id) . timestamp . hmac.
const APP_ID = '1419000000000000001';
const FAKE_TOKEN = `${Buffer.from(APP_ID).toString('base64').replace(/=+$/, '')}.GaBcDe.${'x'.repeat(38)}`;

describe('invite', () => {
  it('derives the application id from the token', () => {
    expect(clientIdFromToken(FAKE_TOKEN)).toBe(APP_ID);
  });

  it('returns null for a token of another shape', () => {
    expect(clientIdFromToken('')).toBeNull();
    expect(clientIdFromToken('not-a-token')).toBeNull();
  });

  it('asks for exactly the nine permissions of the runbook', () => {
    // Manage Roles, Manage Channels, Move Members, View Channels, Send Messages, Embed Links,
    // Attach Files (decision 014 §3.1), Read Message History, Connect.
    expect(INVITE_PERMISSIONS).toBe(286_379_024n);
  });

  it('builds the invite URL with both scopes', () => {
    expect(inviteUrl(APP_ID)).toBe(
      `https://discord.com/oauth2/authorize?client_id=${APP_ID}&scope=bot%20applications.commands&permissions=286379024`,
    );
  });
});
