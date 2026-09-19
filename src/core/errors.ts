// A DomainError is an expected refusal (not enough KP, a stale panel, no rights). Its code maps
// to a player-facing message in src/discord/views/errors.ts; the text never lives here (002 §1).

export const DOMAIN_ERROR_CODES = [
  'INSUFFICIENT_FUNDS',
  'NOT_ALLOWED',
  'STALE_PANEL',
  'MATCH_CLOSED',
  'ALREADY_JOINED',
  'MATCH_ALREADY_FINISHED',
  'NOT_FOUND',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DomainError';
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
