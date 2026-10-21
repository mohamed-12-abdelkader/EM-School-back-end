-- Up Migration
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'parent';

-- Down Migration
-- PostgreSQL cannot safely remove enum values.
