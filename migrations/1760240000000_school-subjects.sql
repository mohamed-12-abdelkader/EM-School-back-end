-- Up Migration

CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_school_name ON subjects (school_id, name)
WHERE
    deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_school_code ON subjects (school_id, code)
WHERE
    deleted_at IS NULL
    AND code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON subjects (school_id);

CREATE INDEX IF NOT EXISTS idx_subjects_position ON subjects (school_id, position, id);

-- Link subjects to the grades where they are taught
CREATE TABLE IF NOT EXISTS subject_grades (
    subject_id INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
    grade_id INTEGER NOT NULL REFERENCES grades (id) ON DELETE CASCADE,
    PRIMARY KEY (subject_id, grade_id)
);

CREATE INDEX IF NOT EXISTS idx_subject_grades_grade_id ON subject_grades (grade_id);

-- Down Migration
DROP INDEX IF EXISTS idx_subject_grades_grade_id;

DROP TABLE IF EXISTS subject_grades;

DROP INDEX IF EXISTS idx_subjects_position;

DROP INDEX IF EXISTS idx_subjects_school_id;

DROP INDEX IF EXISTS idx_subjects_school_code;

DROP INDEX IF EXISTS idx_subjects_school_name;

DROP TABLE IF EXISTS subjects;
