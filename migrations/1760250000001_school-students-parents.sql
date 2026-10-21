-- Up Migration

CREATE TYPE student_status AS ENUM ('active', 'suspended', 'archived');

CREATE TYPE parent_relation AS ENUM ('father', 'mother', 'guardian', 'other');

-- Public school code used with 5-digit login codes (multi-tenant login scope)
ALTER TABLE schools
    ADD COLUMN IF NOT EXISTS login_code TEXT;

UPDATE schools
SET
    login_code = UPPER(SUBSTR(MD5(RANDOM()::TEXT || id::TEXT), 1, 6))
WHERE
    login_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_login_code ON schools (login_code);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS login_code TEXT,
    ADD COLUMN IF NOT EXISTS qr_token TEXT,
    ADD COLUMN IF NOT EXISTS qr_issued_at TIMESTAMP;

-- Login codes unique per school among student/parent accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_school_login_code ON users (school_id, login_code)
WHERE
    login_code IS NOT NULL
    AND school_id IS NOT NULL
    AND deleted_at IS NULL
    AND role IN ('student', 'parent');

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_qr_token ON users (qr_token)
WHERE
    qr_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    national_id TEXT,
    birth_date DATE,
    gender TEXT,
    address TEXT,
    academic_year TEXT NOT NULL,
    grade_id INTEGER NOT NULL REFERENCES grades (id) ON DELETE RESTRICT,
    classroom_id INTEGER NOT NULL REFERENCES classrooms (id) ON DELETE RESTRICT,
    enrollment_date DATE DEFAULT CURRENT_DATE,
    seat_number TEXT,
    status student_status NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW (),
    updated_at TIMESTAMP DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_grade ON student_profiles (grade_id);

CREATE INDEX IF NOT EXISTS idx_student_profiles_classroom ON student_profiles (classroom_id);

CREATE INDEX IF NOT EXISTS idx_student_profiles_status ON student_profiles (status);

CREATE INDEX IF NOT EXISTS idx_student_profiles_year ON student_profiles (academic_year);

CREATE TABLE IF NOT EXISTS parent_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    national_id TEXT,
    secondary_phone TEXT,
    address TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW (),
    updated_at TIMESTAMP DEFAULT NOW ()
);

CREATE TABLE IF NOT EXISTS parent_students (
    parent_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    relation parent_relation NOT NULL DEFAULT 'guardian',
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW (),
    PRIMARY KEY (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students (student_id);

CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students (parent_id);

-- Ensure at most one primary parent flag per student (optional soft rule via partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_parent_per_student ON parent_students (student_id)
WHERE
    is_primary = TRUE;

-- Basic login attempt tracking for code-based login (anti-guessing foundation)
CREATE TABLE IF NOT EXISTS login_code_attempts (
    id SERIAL PRIMARY KEY,
    school_id INTEGER REFERENCES schools (id) ON DELETE CASCADE,
    login_code TEXT,
    ip_address TEXT,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_login_code_attempts_created ON login_code_attempts (created_at);

CREATE INDEX IF NOT EXISTS idx_login_code_attempts_school_ip ON login_code_attempts (school_id, ip_address, created_at);

-- Down Migration
DROP INDEX IF EXISTS idx_login_code_attempts_school_ip;

DROP INDEX IF EXISTS idx_login_code_attempts_created;

DROP TABLE IF EXISTS login_code_attempts;

DROP INDEX IF EXISTS idx_one_primary_parent_per_student;

DROP INDEX IF EXISTS idx_parent_students_parent;

DROP INDEX IF EXISTS idx_parent_students_student;

DROP TABLE IF EXISTS parent_students;

DROP TABLE IF EXISTS parent_profiles;

DROP INDEX IF EXISTS idx_student_profiles_year;

DROP INDEX IF EXISTS idx_student_profiles_status;

DROP INDEX IF EXISTS idx_student_profiles_classroom;

DROP INDEX IF EXISTS idx_student_profiles_grade;

DROP TABLE IF EXISTS student_profiles;

DROP INDEX IF EXISTS idx_users_qr_token;

DROP INDEX IF EXISTS idx_users_school_login_code;

ALTER TABLE users
DROP COLUMN IF EXISTS qr_issued_at,
DROP COLUMN IF EXISTS qr_token,
DROP COLUMN IF EXISTS login_code;

DROP INDEX IF EXISTS idx_schools_login_code;

ALTER TABLE schools
DROP COLUMN IF EXISTS login_code;

DROP TYPE IF EXISTS parent_relation;

DROP TYPE IF EXISTS student_status;
