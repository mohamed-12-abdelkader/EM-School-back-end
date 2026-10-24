import './loadTestEnv';
import { applyMigrations } from '../db/migrate';
import pool from '../db/pool';
import { config } from '../config/env';

async function main() {
  // eslint-disable-next-line no-console
  console.log(`[migrate:test] ${config.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
  await applyMigrations(config.DATABASE_URL, 'up');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
