// Two projects (decision 002 §8): `unit` needs nothing; `db` needs a real PostgreSQL 16 and
// FAILS without one. `npm test` runs both; `npm run test:unit` runs only the first.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Explicit, not vitest's implicit default: NODE_ENV unset means production (src/config/env.ts).
    env: { NODE_ENV: 'test' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          exclude: ['**/*.db.test.ts', 'node_modules/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['src/**/*.db.test.ts', 'tests/db/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/db/global-setup.ts'],
          setupFiles: ['tests/db/setup.ts'],
          // One shared database: files run one after another, tests inside a file in order.
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
