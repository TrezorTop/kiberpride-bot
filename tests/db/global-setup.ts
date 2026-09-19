// Runs once before the `db` project: the database must be reachable (a missing database FAILS
// the suite, it is never skipped — decision 002 §8), then every migration is applied to it.
import { execSync } from 'node:child_process';
import pg from 'pg';
import { describeUrl, TEST_DATABASE_URL } from './env.js';

export default async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (err) {
    throw new Error(
      `Test database unreachable at ${describeUrl(TEST_DATABASE_URL)} (${reason(err)}). ` +
        'Start it with `npm run db:up` (Docker Desktop must be running). The db tests never skip.',
      { cause: err },
    );
  } finally {
    await client.end().catch(() => {});
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}

// A refused connection to «localhost» is an AggregateError (IPv6 + IPv4) with an empty message.
function reason(err: unknown): string {
  const e = err as { message?: string; code?: string };
  return e.message || e.code || String(err);
}
