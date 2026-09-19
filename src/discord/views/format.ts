// Money and ledger formatting, one style everywhere (spec §1, decision 005: `💰 1 250 KP Coin`,
// `+100 KP Coin — победа в CS2`, `-500 KP Coin — доступ к GIF`).

/** The currency name players see after every amount (decision 005). */
export const CURRENCY = 'KP Coin';

/** 1250 → «1 250». Groups of three with a plain space, as in the spec. */
export function groupDigits(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A balance: `💰 1 250 KP Coin`. */
export function formatKp(amount: number): string {
  return `💰 ${groupDigits(amount)} ${CURRENCY}`;
}

/** A movement: `+100 KP Coin` / `-500 KP Coin`. */
export function formatSignedKp(amount: number): string {
  return `${amount > 0 ? '+' : ''}${groupDigits(amount)} ${CURRENCY}`;
}

/** One history line: `+100 KP Coin — победа в CS2`. */
export function formatLedgerLine(entry: { amount: number; description: string }): string {
  return `${formatSignedKp(entry.amount)} — ${entry.description}`;
}
