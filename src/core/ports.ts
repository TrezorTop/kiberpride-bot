// Ports: what the domain modules need done in Discord, without importing discord.js (002 §2).
// src/discord/gateway.ts implements them; unit tests use fakes. Every method must be
// idempotent — side effects are replayed by reconcilers, never inside a db transaction.
//
// The first release grows these as modules arrive: roles (shop grants), voice channels and
// overwrites, moving members, recruitment messages, membership checks (decision 004 §6).

export interface GuildGateway {
  /**
   * Makes sure the bot's log channel exists and returns its id. `currentId` is the stored id;
   * when it is null or the channel is gone, a new admin-only channel is created.
   */
  ensureLogChannel(currentId: string | null): Promise<string>;
}

/** The Discord log channel (rule bot-always-on §3): ids, names and amounts, never secrets. */
export interface AuditLog {
  post(line: string): Promise<void>;
}
