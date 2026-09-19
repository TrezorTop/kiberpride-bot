// Money and ledger formatting, one style everywhere (spec §1: `💰 1 250 KP`,
// `+100 KP — победа в CS2`, `-500 KP — доступ к GIF`).

/** 1250 → «1 250». Groups of three with a plain space, as in the spec. */
export function groupDigits(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A balance: `💰 1 250 KP`. */
export function formatKp(amount: number): string {
  return `💰 ${groupDigits(amount)} KP`;
}

/** A movement: `+100 KP` / `-500 KP`. */
export function formatSignedKp(amount: number): string {
  return `${amount > 0 ? '+' : ''}${groupDigits(amount)} KP`;
}

/** One history line: `+100 KP — победа в CS2`. */
export function formatLedgerLine(entry: { amount: number; description: string }): string {
  return `${formatSignedKp(entry.amount)} — ${entry.description}`;
}
