-- Up Migration
-- Task worksheets (PDF) + questions (MCQ / written) like exams

CREATE TABLE IF NOT EXISTS teacher_task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES teacher_tasks (id) ON DELETE CASCADE,
  kind teacher_attachment_kind NOT NULL DEFAULT 'pdf',
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  filename TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_task_attachments_task_idx ON teacher_task_attachments (task_id);

CREATE TABLE IF NOT EXISTS teacher_task_questions (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES teacher_tasks (id) ON DELETE CASCADE,
  type teacher_exam_question_type NOT NULL,
  text TEXT NOT NULL,
  points NUMERIC(8, 2) NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  model_answer TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_task_questions_task_idx ON teacher_task_questions (task_id);

CREATE TABLE IF NOT EXISTS teacher_task_choices (
  id SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES teacher_task_questions (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS teacher_task_choices_question_idx ON teacher_task_choices (question_id);

-- Down Migration
DROP TABLE IF EXISTS teacher_task_choices;
DROP TABLE IF EXISTS teacher_task_questions;
DROP TABLE IF EXISTS teacher_task_attachments;
