// Shared by every db test file: one client with a pool big enough for the concurrency tests,
// and a truncate of every application table before each test.
import { createDb, type Db } from '../../src/db/client.js';
import { TEST_DATABASE_URL } from './env.js';

let db: Db | null = null;

export function testDb(): Db {
  db ??= createDb(TEST_DATABASE_URL, { maxConnections: 20 });
  return db;
}

export async function truncateAll(): Promise<void> {
  const rows = await testDb().$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await testDb().$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function closeTestDb(): Promise<void> {
  if (db) await db.$disconnect();
  db = null;
}
