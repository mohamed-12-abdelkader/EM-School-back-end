-- Up Migration

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');

CREATE TYPE attendance_check_in_method AS ENUM ('qr', 'manual');

CREATE TABLE IF NOT EXISTS attendance_records (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    status attendance_status NOT NULL,
    check_in_time TIMESTAMPTZ,
    check_in_method attendance_check_in_method,
    absence_reason TEXT,
    notes TEXT,
    excuse_approved BOOLEAN,
    recorded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    edit_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    CONSTRAINT attendance_records_absence_reason_check CHECK (
        status NOT IN ('absent', 'excused')
        OR absence_reason IS NULL
        OR length(trim(absence_reason)) > 0
    )
);

-- One active attendance row per student per calendar day
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_active ON attendance_records (school_id, student_id, attendance_date)
WHERE
    cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance_records (school_id, attendance_date)
WHERE
    cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records (student_id, attendance_date)
WHERE
    cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_school_status_date ON attendance_records (school_id, status, attendance_date)
WHERE
    cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_school_student ON attendance_records (school_id, student_id)
WHERE
    cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS attendance_audit_logs (
    id SERIAL PRIMARY KEY,
    attendance_id INTEGER NOT NULL REFERENCES attendance_records (id) ON DELETE CASCADE,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    old_status attendance_status,
    new_status attendance_status,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    changed_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_attendance ON attendance_audit_logs (attendance_id);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_school ON attendance_audit_logs (school_id, created_at DESC);

-- Down Migration
DROP INDEX IF EXISTS idx_attendance_audit_school;

DROP INDEX IF EXISTS idx_attendance_audit_attendance;

DROP TABLE IF EXISTS attendance_audit_logs;

DROP INDEX IF EXISTS idx_attendance_school_student;

DROP INDEX IF EXISTS idx_attendance_school_status_date;

DROP INDEX IF EXISTS idx_attendance_student_date;

DROP INDEX IF EXISTS idx_attendance_school_date;

DROP INDEX IF EXISTS idx_attendance_unique_active;

DROP TABLE IF EXISTS attendance_records;

DROP TYPE IF EXISTS attendance_check_in_method;

DROP TYPE IF EXISTS attendance_status;
