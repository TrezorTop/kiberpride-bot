// Prisma CLI configuration (Prisma 7: the connection string lives here, not in schema.prisma).
// `generate` needs no database, so a missing DATABASE_URL is tolerated; `migrate` fails loudly.
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
