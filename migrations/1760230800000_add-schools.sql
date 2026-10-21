-- Up Migration

-- School admin role for per-school dashboard accounts (Super Admin remains 'admin')
-- Must commit before the new enum value is used (see next migration).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'school_admin';

CREATE TABLE IF NOT EXISTS schools (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    logo TEXT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_school_id ON users (school_id);

CREATE INDEX IF NOT EXISTS idx_schools_created_at ON schools (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_schools_name ON schools (name);

-- Down Migration
DROP INDEX IF EXISTS idx_schools_name;

DROP INDEX IF EXISTS idx_schools_created_at;

DROP INDEX IF EXISTS idx_users_school_id;

ALTER TABLE users
DROP COLUMN IF EXISTS school_id;

DROP TABLE IF EXISTS schools;

-- Note: PostgreSQL cannot remove an enum value safely; 'school_admin' is left in user_role.
