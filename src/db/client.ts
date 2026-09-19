// The one PrismaClient of the process (decision 002 §1), on the node-postgres driver adapter.
// Created by the composition root (src/main.ts) or by the db tests with their own URL.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
export { Prisma };

export interface DbOptions {
  /** Pool size. Concurrent button presses each hold a connection for one short transaction. */
  maxConnections?: number;
}

export function createDb(databaseUrl: string, options: DbOptions = {}): Db {
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: options.maxConnections ?? 10 });
  return new PrismaClient({ adapter });
}
