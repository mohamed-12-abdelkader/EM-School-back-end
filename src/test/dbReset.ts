import pool from '../db/pool';

/** Wipe app data between tests; keep migration history. */
export async function resetDatabase() {
  await pool.query(`
    DO $$
    DECLARE
      stmt text;
    BEGIN
      SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ')
             || ' RESTART IDENTITY CASCADE'
        INTO stmt
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> 'migrations';

      IF stmt IS NOT NULL THEN
        EXECUTE stmt;
      END IF;
    END $$;
  `);
}
