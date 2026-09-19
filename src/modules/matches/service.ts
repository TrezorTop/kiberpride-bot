// Matches — NOT implemented in this step. The state machine is decision 004: every transition
// is one transaction opening with a conditional UPDATE on status (and version for organiser
// flows); Discord follows the database through `sync`.

export type WinnerChoice = 'A' | 'B' | 'DRAW';

export interface MatchesService {
  join(matchId: number, userId: string): Promise<void>;
  leave(matchId: number, userId: string): Promise<void>;
  finish(input: { matchId: number; version: number; winner: WinnerChoice; mvpUserId: string; actorId: string }): Promise<void>;
  cancel(input: { matchId: number; version: number; actorId: string }): Promise<void>;
  /** Makes Discord match the database for one match; idempotent (004 §6). */
  sync(matchId: number): Promise<void>;
  /** Ids of matches that need a sync at startup: non-terminal or syncedVersion < version. */
  needingSync(): Promise<number[]>;
}
