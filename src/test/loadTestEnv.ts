/**
 * Must run before any `app` / `pool` / `config` import.
 * Vitest `setupFiles` loads this first so dotenv/config does not stick to .env (dev DB).
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const root = path.resolve(__dirname, '../..');
const envTestPath = path.join(root, '.env.test');

if (!fs.existsSync(envTestPath)) {
  throw new Error(
    'Missing .env.test — copy .env.test.example and set DATABASE_URL to a dedicated *test* database.',
  );
}

dotenv.config({ path: envTestPath, override: true });
process.env.NODE_ENV = 'test';
// Keep HTTP noise down during Supertest runs
process.env.PINO_LOG_LEVEL = 'silent';

export function databaseNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const name = u.pathname.replace(/^\//, '');
    return name || null;
  } catch {
    const m = url.match(/\/([^/?]+)(?:\?|$)/);
    return m?.[1] ?? null;
  }
}

export function assertTestDatabaseUrl(url: string | undefined): asserts url is string {
  if (!url) {
    throw new Error('DATABASE_URL is required for integration tests');
  }
  const db = databaseNameFromUrl(url);
  if (!db || !/test/i.test(db)) {
    throw new Error(
      `Refusing to run integration tests against non-test database "${db ?? '(unknown)'}". ` +
        'Point DATABASE_URL in .env.test at a DB whose name contains "test" (e.g. em-school-test).',
    );
  }
  if (/\/em-school(\?|$)/i.test(url) && !/em-school-test/i.test(url)) {
    throw new Error('Refusing to use development database em-school for integration tests.');
  }
}

assertTestDatabaseUrl(process.env.DATABASE_URL);
