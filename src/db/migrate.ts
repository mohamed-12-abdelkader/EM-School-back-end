import { runner } from 'node-pg-migrate';
import path from 'path';
import { config } from '../utils';
import pool from './pool';
import bcrypt from 'bcrypt';
import { pgSsl } from './ssl';

export async function applyMigrations(databaseUrl: string, direction: 'up' | 'down') {
  await runner({
    count: Number.POSITIVE_INFINITY,
    databaseUrl: {
      connectionString: databaseUrl,
      ssl: pgSsl,
    },
    dir: path.resolve(__dirname, '../../migrations'),
    direction,
    migrationsTable: 'migrations',
    verbose: false,
  });

  if (direction !== 'up') return;

  const { FIRST_SUPERUSER, FIRST_SUPERUSER_PASSWORD } = config;

  if (!FIRST_SUPERUSER || !FIRST_SUPERUSER_PASSWORD) return;

  const exists = await pool.query('SELECT id FROM users WHERE email = $1 OR phone = $1', [
    FIRST_SUPERUSER,
  ]);

  if (exists.rowCount === 0) {
    const hashed = await bcrypt.hash(FIRST_SUPERUSER_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (email, phone, password, name, role)
       VALUES (
         $1,
         CASE WHEN POSITION('@' IN $1) = 0 THEN $1 ELSE NULL END,
         $2,
         $1,
         'admin'
       )`,
      [FIRST_SUPERUSER, hashed],
    );
    console.log('✅ First superuser created.');
  } else {
    console.log('ℹ️  First superuser already exists.');
  }
}
