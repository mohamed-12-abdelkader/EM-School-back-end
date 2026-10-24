-- Up Migration
-- Standalone teacher opinions / reports about a student (visible to guardians)

CREATE TABLE IF NOT EXISTS teacher_student_opinions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  classroom_id INTEGER REFERENCES classrooms (id) ON DELETE SET NULL,
  subject_id INTEGER REFERENCES subjects (id) ON DELETE SET NULL,
  title TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS teacher_student_opinions_student_idx
  ON teacher_student_opinions (student_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS teacher_student_opinions_teacher_idx
  ON teacher_student_opinions (teacher_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS teacher_student_opinions_school_idx
  ON teacher_student_opinions (school_id)
  WHERE deleted_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS teacher_student_opinions;
