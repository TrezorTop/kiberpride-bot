// Where the `db` test project connects (decision 002 §8). Locally: the postgres-test service of
// docker-compose.dev.yml; on GitHub Actions: the postgres:16 service container.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://kiber:kiber@localhost:5433/kiberpride_test';

/** host:port/db without credentials, for error messages. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable TEST_DATABASE_URL)';
  }
}
