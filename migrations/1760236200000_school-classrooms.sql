-- Up Migration

-- Classrooms/sections inside a grade (e.g. 1/1 under أولى إعدادي)
CREATE TABLE IF NOT EXISTS classrooms (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    grade_id INTEGER NOT NULL REFERENCES grades (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    capacity INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP,
    CONSTRAINT classrooms_capacity_check CHECK (
        capacity IS NULL
        OR capacity >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_classrooms_school_grade_name ON classrooms (school_id, grade_id, name)
WHERE
    deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_classrooms_school_id ON classrooms (school_id);

CREATE INDEX IF NOT EXISTS idx_classrooms_grade_id ON classrooms (grade_id);

CREATE INDEX IF NOT EXISTS idx_classrooms_position ON classrooms (school_id, grade_id, position, id);

-- Down Migration
DROP INDEX IF EXISTS idx_classrooms_position;

DROP INDEX IF EXISTS idx_classrooms_grade_id;

DROP INDEX IF EXISTS idx_classrooms_school_id;

DROP INDEX IF EXISTS idx_classrooms_school_grade_name;

DROP TABLE IF EXISTS classrooms;
