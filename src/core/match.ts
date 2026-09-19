// The shape of a match as the domain hands it to Discord (decisions 004, 008). Plain data, no
// Prisma or discord.js types: the matches module builds it, the gateway and the views render it.

export type MatchStatusName = 'RECRUITING' | 'TEAMS_PENDING' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
export type TeamName = 'A' | 'B';
export type WinnerName = 'A' | 'B' | 'DRAW';
export type TeamModeName = 'AUTO' | 'MANUAL';

export const TERMINAL_STATUSES: readonly MatchStatusName[] = ['FINISHED', 'CANCELLED'];
export const OPEN_STATUSES: readonly MatchStatusName[] = ['RECRUITING', 'TEAMS_PENDING', 'IN_PROGRESS'];

export function isTerminal(status: MatchStatusName): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Resolved reward amounts in whole KP; a missing rule is 0 (decision 008 §12). */
export interface RewardAmounts {
  participation: number;
  win: number;
  mvp: number;
  draw: number;
}

export interface ParticipantSnapshot {
  userId: string;
  team: TeamName | null;
  joinedAt: Date;
  /** Set when the player left the Discord server during IN_PROGRESS (004 §5). */
  leftServerAt: Date | null;
}

export interface MatchSnapshot {
  id: number;
  game: { id: number; name: string; emoji: string };
  title: string;
  teamSize: number;
  capacity: number;
  teamMode: TeamModeName;
  status: MatchStatusName;
  version: number;
  syncedVersion: number;
  announcedStatus: MatchStatusName | null;
  participantCount: number;
  createdById: string;
  recruitChannelId: string;
  recruitMessageId: string | null;
  voiceCategoryId: string;
  voiceChannelAId: string | null;
  voiceChannelBId: string | null;
  rewards: RewardAmounts;
  special: boolean;
  winner: WinnerName | null;
  mvpUserId: string | null;
  createdAt: Date;
  endedAt: Date | null;
  /** null on a CANCELLED match = closed by the recruit timeout (decision 009 §5). */
  endedById: string | null;
  /** In join order. */
  participants: ParticipantSnapshot[];
}

/** The voice channel names of decision 008 §7; the suffix tells concurrent matches apart. */
export function voiceChannelName(team: TeamName, matchId: number): string {
  return team === 'A' ? `🔵 Команда A · #${matchId}` : `🔴 Команда B · #${matchId}`;
}

/** Matches any name `voiceChannelName` produces and captures the match id (008 §7 orphans). */
export const VOICE_CHANNEL_NAME_RE = /^(🔵 Команда A|🔴 Команда B) · #(\d+)$/u;

// ─── Fake players for tests (decision 008 §10) ──────────────────────────────

/**
 * A fake id starts with `0` and is 17 digits long; Discord never issues such an id. Every
 * gateway call path skips them: no overwrite, no move, no membership check.
 */
export function isFakeUserId(id: string): boolean {
  return /^0\d{16}$/.test(id);
}

/** The k-th fake player, k ≥ 1. */
export function fakeUserId(k: number): string {
  if (!Number.isSafeInteger(k) || k < 1) throw new Error(`bad fake player number ${k}`);
  return `0${String(k).padStart(16, '0')}`;
}

/** The k of a fake id, for «🧪 Тестовый игрок k». */
export function fakeUserNumber(id: string): number {
  return Number(id.slice(1));
}
