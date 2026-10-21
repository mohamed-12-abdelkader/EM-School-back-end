import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const tables = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename ILIKE '%migra%'`,
  );
  console.log('migration tables:', tables.rows);

  for (const { tablename } of tables.rows) {
    if (tablename.toLowerCase().includes('lock')) {
      await pool.query(`DELETE FROM "${tablename}"`);
      console.log('cleared', tablename);
    }
  }

  // node-pg-migrate advisory lock
  await pool.query('SELECT pg_advisory_unlock_all()');
  console.log('advisory locks released');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
