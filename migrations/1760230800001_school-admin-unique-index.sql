-- Up Migration

-- At most one school_admin account per school
-- Separate migration so 'school_admin' enum value is committed first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_school_admin_per_school ON users (school_id)
WHERE
    role = 'school_admin'
    AND school_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_one_school_admin_per_school;
