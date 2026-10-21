-- Up Migration

CREATE TYPE timetable_status AS ENUM ('draft', 'published');

CREATE TYPE timetable_slot_type AS ENUM ('lesson', 'break', 'activity', 'reserve');

-- Per-school timetable defaults
CREATE TABLE IF NOT EXISTS timetable_settings (
    school_id INTEGER PRIMARY KEY REFERENCES schools (id) ON DELETE CASCADE,
    -- 0=Sunday ... 6=Saturday
    working_days INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4],
    periods_per_day INTEGER NOT NULL DEFAULT 7,
    default_period_minutes INTEGER NOT NULL DEFAULT 45,
    day_start_time TIME NOT NULL DEFAULT '08:00',
    day_end_time TIME NOT NULL DEFAULT '14:00',
    allow_teacher_conflicts BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT NOW (),
    CONSTRAINT timetable_settings_periods_check CHECK (periods_per_day BETWEEN 1 AND 20),
    CONSTRAINT timetable_settings_duration_check CHECK (default_period_minutes BETWEEN 5 AND 240)
);

-- Default period schedule for a school (can differ by day via day_of_week NULL = all days)
CREATE TABLE IF NOT EXISTS timetable_period_templates (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    day_of_week INTEGER, -- NULL = applies to all working days; else 0-6
    period_number INTEGER NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    label TEXT,
    slot_type timetable_slot_type NOT NULL DEFAULT 'lesson',
    CONSTRAINT timetable_period_templates_day_check CHECK (
        day_of_week IS NULL
        OR day_of_week BETWEEN 0 AND 6
    ),
    CONSTRAINT timetable_period_templates_period_check CHECK (period_number BETWEEN 1 AND 20),
    CONSTRAINT timetable_period_templates_time_check CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_period_templates_unique ON timetable_period_templates (
    school_id,
    COALESCE(day_of_week, -1),
    period_number
);

CREATE INDEX IF NOT EXISTS idx_period_templates_school ON timetable_period_templates (school_id);

-- Weekly timetable for one classroom within academic year/term
CREATE TABLE IF NOT EXISTS timetables (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    classroom_id INTEGER NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    term TEXT NOT NULL DEFAULT '1',
    title TEXT,
    status timetable_status NOT NULL DEFAULT 'draft',
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    published_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    published_at TIMESTAMP,
    last_published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW (),
    updated_at TIMESTAMP DEFAULT NOW (),
    deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetables_unique_active ON timetables (
    school_id,
    classroom_id,
    academic_year,
    term
)
WHERE
    deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_timetables_school ON timetables (school_id);

CREATE INDEX IF NOT EXISTS idx_timetables_classroom ON timetables (classroom_id);

CREATE INDEX IF NOT EXISTS idx_timetables_status ON timetables (school_id, status);

-- Individual cells in the weekly grid
CREATE TABLE IF NOT EXISTS timetable_slots (
    id SERIAL PRIMARY KEY,
    timetable_id INTEGER NOT NULL REFERENCES timetables (id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,
    period_number INTEGER NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_type timetable_slot_type NOT NULL DEFAULT 'lesson',
    subject_id INTEGER REFERENCES subjects (id) ON DELETE SET NULL,
    teacher_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW (),
    updated_at TIMESTAMP DEFAULT NOW (),
    CONSTRAINT timetable_slots_day_check CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT timetable_slots_period_check CHECK (period_number BETWEEN 1 AND 20),
    CONSTRAINT timetable_slots_time_check CHECK (end_time > start_time),
    CONSTRAINT timetable_slots_lesson_fields_check CHECK (
        slot_type <> 'lesson'
        OR (
            subject_id IS NOT NULL
            AND teacher_id IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_slots_unique_cell ON timetable_slots (timetable_id, day_of_week, period_number);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher ON timetable_slots (teacher_id);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_subject ON timetable_slots (subject_id);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_timetable ON timetable_slots (timetable_id);

-- Down Migration
DROP INDEX IF EXISTS idx_timetable_slots_timetable;

DROP INDEX IF EXISTS idx_timetable_slots_subject;

DROP INDEX IF EXISTS idx_timetable_slots_teacher;

DROP INDEX IF EXISTS idx_timetable_slots_unique_cell;

DROP TABLE IF EXISTS timetable_slots;

DROP INDEX IF EXISTS idx_timetables_status;

DROP INDEX IF EXISTS idx_timetables_classroom;

DROP INDEX IF EXISTS idx_timetables_school;

DROP INDEX IF EXISTS idx_timetables_unique_active;

DROP TABLE IF EXISTS timetables;

DROP INDEX IF EXISTS idx_period_templates_school;

DROP INDEX IF EXISTS idx_period_templates_unique;

DROP TABLE IF EXISTS timetable_period_templates;

DROP TABLE IF EXISTS timetable_settings;

DROP TYPE IF EXISTS timetable_slot_type;

DROP TYPE IF EXISTS timetable_status;
