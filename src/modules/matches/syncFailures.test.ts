import { describe, expect, it } from 'vitest';
import { createFailureDedupe } from './syncFailures.js';

describe('sync failure dedupe (review 2026-09-20)', () => {
  it('reports once per (match, version), again when the version moves, per match', () => {
    const d = createFailureDedupe();
    expect(d.firstFor(7, 3)).toBe(true);
    expect(d.firstFor(7, 3)).toBe(false);
    expect(d.firstFor(7, 3)).toBe(false);
    expect(d.firstFor(8, 3)).toBe(true);
    expect(d.firstFor(7, 4)).toBe(true);
    expect(d.firstFor(7, 4)).toBe(false);
  });
});
