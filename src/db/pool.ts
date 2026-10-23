import { Pool } from 'pg';
import { config } from '../utils';
import { pgSsl } from './ssl';

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: pgSsl,
});

// Ensure Arabic/UTF-8 is never mangled on the wire
pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'").catch(() => undefined);
});

export default pool;
