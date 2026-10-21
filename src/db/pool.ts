import { Pool } from 'pg';
import { config } from '../utils';
import { pgSsl } from './ssl';

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: pgSsl,
});

export default pool;
