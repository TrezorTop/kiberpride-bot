// Random teams (decision 004 §2): Fisher–Yates driven by crypto.randomInt, so no player can
// predict or game the split the way Math.random would allow.
import { randomInt } from 'node:crypto';

/** A shuffled copy; `rand(n)` returns an integer in [0, n). */
export function shuffle<T>(items: readonly T[], rand: (n: number) => number = (n) => randomInt(n)): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
