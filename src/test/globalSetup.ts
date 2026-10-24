import './loadTestEnv';
import { applyMigrations } from '../db/migrate';
import pool from '../db/pool';
import { config } from '../config/env';

/**
 * Runs once before the integration suite: migrate the dedicated test DB.
 */
export default async function globalSetup() {
  // eslint-disable-next-line no-console
  console.log(`[integration] Migrating test DB → ${config.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
  await applyMigrations(config.DATABASE_URL, 'up');
  await pool.end();
}
