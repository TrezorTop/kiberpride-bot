// The environment holds secrets and deployment identity only (decision 002 §6); everything
// the owner may change lives in the database. The owner pastes only DISCORD_TOKEN: the client
// id is derived from it and the guild is discovered at start (src/discord/client.ts).
import { execSync } from 'node:child_process';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord id (17-20 digits)');
// An empty line in .env (`DISCORD_GUILD_ID=`) means «not set».
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(50, 'DISCORD_TOKEN is empty or too short — see runbooks/discord-app-setup.md §2'),
  DISCORD_CLIENT_ID: optional(snowflake),
  DISCORD_GUILD_ID: optional(snowflake),
  DATABASE_URL: z.string().trim().startsWith('postgresql://', 'DATABASE_URL must start with postgresql://'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Unset means production: test-only features (008 §10) must be switched on, never left on by
  // a forgotten variable. `npm run dev` and .env.example set development; vitest sets test.
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  APP_VERSION: optional(z.string().trim().min(1)),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses the environment; the error names the variable, never its value. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

/** APP_VERSION (baked into the image at build), else the git short sha, else «dev». */
export function resolveVersion(env: Pick<Env, 'APP_VERSION'>): string {
  if (env.APP_VERSION) return env.APP_VERSION;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}
