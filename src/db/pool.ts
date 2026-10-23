import { Pool } from 'pg';
import { config } from '../utils';
import { pgSsl } from './ssl';

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: pgSsl,
  // Fail fast when Aiven/remote DB is unreachable (default Node connect can hang ~60s+)
  connectionTimeoutMillis: 8_000,
  idleTimeoutMillis: 30_000,
  max: 10,
});

// Ensure Arabic/UTF-8 is never mangled on the wire
pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'").catch(() => undefined);
});

export default pool;
