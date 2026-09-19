// A DomainError is an expected refusal (not enough KP, a stale panel, no rights). Its code maps
// to a player-facing message in src/discord/views/messages.ts; the text never lives here (002 §1).

export const DOMAIN_ERROR_CODES = [
  'INSUFFICIENT_FUNDS',
  'NOT_ALLOWED',
  'STALE_PANEL',
  'MATCH_CLOSED',
  'ALREADY_JOINED',
  'MATCH_ALREADY_FINISHED',
  'MATCH_CANCELLED',
  'NOT_FOUND',
  'SETUP_REQUIRED',
  'BOT_MISSING_PERMISSIONS',
  'NOT_A_PARTICIPANT',
  'TEAMS_NOT_READY',
  'NOT_IN_MATCH',
  'BUSY_IN_MATCH',
  'ROSTER_LOCKED',
  'MATCH_STARTED',
  'SPECIAL_ONLY_RECRUITING',
  // Shop and earnings (decision 014)
  'SHOP_UNAVAILABLE',
  'GOOD_DISABLED',
  'ALREADY_OWNED',
  'ALREADY_CLAIMED',
  'DAILY_OFF',
  'NAME_INVALID',
  'NAME_TAKEN',
  'CLAN_FULL',
  'IN_OTHER_CLAN',
  'NOT_OWNER',
  'NO_CLAN',
  'NO_ROOM',
  'ROOM_FULL',
  'INVALID_TARGET',
  'NOT_A_MEMBER',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** Facts the player-facing text may show, e.g. the permissions the bot lacks. Never secrets. */
export interface DomainErrorParams {
  missing?: readonly string[];
  /** A moment the text names, e.g. when the next daily bonus opens. */
  at?: Date;
  /** Why a name was refused (clan and room names), a NameProblem code. */
  reason?: string;
}

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    detail?: string,
    readonly params: DomainErrorParams = {},
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DomainError';
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
