-- Up Migration

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- One teaching subject per school teacher
CREATE TABLE IF NOT EXISTS teacher_subjects (
    user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_teacher_subjects_subject_id ON teacher_subjects (subject_id);

CREATE INDEX IF NOT EXISTS idx_users_school_teachers ON users (school_id, role)
WHERE
    role = 'teacher'
    AND school_id IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_users_school_teachers;

DROP INDEX IF EXISTS idx_teacher_subjects_subject_id;

DROP TABLE IF EXISTS teacher_subjects;

ALTER TABLE users
DROP COLUMN IF EXISTS deleted_at,
DROP COLUMN IF EXISTS is_active;
