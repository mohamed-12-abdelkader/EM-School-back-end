-- Up Migration
-- Student portal: exam attempts, task answers, in-app notifications

CREATE TABLE IF NOT EXISTS student_exam_attempts (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES teacher_exams (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score NUMERIC(8, 2) NOT NULL DEFAULT 0,
  max_score NUMERIC(8, 2) NOT NULL DEFAULT 0,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS student_exam_attempts_student_idx
  ON student_exam_attempts (student_id);

CREATE TABLE IF NOT EXISTS student_exam_answers (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES student_exam_attempts (id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES teacher_exam_questions (id) ON DELETE CASCADE,
  choice_id INTEGER REFERENCES teacher_exam_choices (id) ON DELETE SET NULL,
  written_answer TEXT,
  is_correct BOOLEAN,
  points_awarded NUMERIC(8, 2) NOT NULL DEFAULT 0,
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS student_exam_answers_attempt_idx
  ON student_exam_answers (attempt_id);

ALTER TABLE teacher_task_grades
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS submission_note TEXT;

CREATE TABLE IF NOT EXISTS student_task_answers (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES teacher_tasks (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES teacher_task_questions (id) ON DELETE CASCADE,
  choice_id INTEGER REFERENCES teacher_task_choices (id) ON DELETE SET NULL,
  written_answer TEXT,
  is_correct BOOLEAN,
  points_awarded NUMERIC(8, 2) NOT NULL DEFAULT 0,
  UNIQUE (task_id, student_id, question_id)
);

CREATE INDEX IF NOT EXISTS student_task_answers_student_idx
  ON student_task_answers (student_id, task_id);

DO $$ BEGIN
  CREATE TYPE student_notification_kind AS ENUM (
    'lesson',
    'exam',
    'task',
    'grade',
    'announcement'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS student_notifications (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  kind student_notification_kind NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_notifications_student_idx
  ON student_notifications (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS student_notifications_unread_idx
  ON student_notifications (student_id)
  WHERE read_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS student_notifications;
DROP TYPE IF EXISTS student_notification_kind;
DROP TABLE IF EXISTS student_task_answers;
ALTER TABLE teacher_task_grades
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS submission_note;
DROP TABLE IF EXISTS student_exam_answers;
DROP TABLE IF EXISTS student_exam_attempts;
