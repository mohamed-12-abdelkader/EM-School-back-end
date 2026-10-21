-- Up Migration

-- Make grades school-scoped while keeping legacy global grades (school_id IS NULL)
ALTER TABLE grades
    ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools (id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Replace global unique name with per-school uniqueness
ALTER TABLE grades
DROP CONSTRAINT IF EXISTS grades_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_school_name ON grades (school_id, name)
WHERE
    school_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_global_name ON grades (name)
WHERE
    school_id IS NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_grades_school_id ON grades (school_id)
WHERE
    school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_grades_school_position ON grades (school_id, position, id);

-- Down Migration
DROP INDEX IF EXISTS idx_grades_school_position;

DROP INDEX IF EXISTS idx_grades_school_id;

DROP INDEX IF EXISTS idx_grades_global_name;

DROP INDEX IF EXISTS idx_grades_school_name;

ALTER TABLE grades
DROP COLUMN IF EXISTS deleted_at,
DROP COLUMN IF EXISTS created_at,
DROP COLUMN IF EXISTS position,
DROP COLUMN IF EXISTS is_active,
DROP COLUMN IF EXISTS description,
DROP COLUMN IF EXISTS school_id;

CREATE UNIQUE INDEX IF NOT EXISTS grades_name_key ON grades (name);
