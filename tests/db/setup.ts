// setupFiles of the `db` project: a clean database for every test.
import { afterAll, beforeEach } from 'vitest';
import { closeTestDb, truncateAll } from './helpers.js';

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestDb();
});
