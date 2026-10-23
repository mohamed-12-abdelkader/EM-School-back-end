-- Up Migration
-- Teacher portal: lessons/materials, exams, graded tasks

CREATE TYPE teacher_attachment_kind AS ENUM ('video', 'pdf');
CREATE TYPE teacher_exam_question_type AS ENUM ('mcq', 'written');
CREATE TYPE teacher_exam_status AS ENUM ('draft', 'published', 'closed');

CREATE TABLE IF NOT EXISTS teacher_lessons (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  classroom_id INTEGER NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS teacher_lessons_teacher_idx ON teacher_lessons (teacher_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS teacher_lessons_classroom_idx ON teacher_lessons (classroom_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS teacher_lesson_attachments (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES teacher_lessons (id) ON DELETE CASCADE,
  kind teacher_attachment_kind NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  filename TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_lesson_attachments_lesson_idx ON teacher_lesson_attachments (lesson_id);

CREATE TABLE IF NOT EXISTS teacher_exams (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  classroom_id INTEGER NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status teacher_exam_status NOT NULL DEFAULT 'draft',
  duration_minutes INTEGER,
  total_points NUMERIC(8, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS teacher_exams_teacher_idx ON teacher_exams (teacher_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS teacher_exam_questions (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES teacher_exams (id) ON DELETE CASCADE,
  type teacher_exam_question_type NOT NULL,
  text TEXT NOT NULL,
  points NUMERIC(8, 2) NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  model_answer TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_exam_questions_exam_idx ON teacher_exam_questions (exam_id);

CREATE TABLE IF NOT EXISTS teacher_exam_choices (
  id SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES teacher_exam_questions (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS teacher_exam_choices_question_idx ON teacher_exam_choices (question_id);

CREATE TABLE IF NOT EXISTS teacher_tasks (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  classroom_id INTEGER NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  max_grade NUMERIC(8, 2) NOT NULL DEFAULT 100,
  due_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS teacher_tasks_teacher_idx ON teacher_tasks (teacher_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS teacher_task_grades (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES teacher_tasks (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  grade NUMERIC(8, 2),
  review TEXT,
  graded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, student_id)
);

CREATE INDEX IF NOT EXISTS teacher_task_grades_task_idx ON teacher_task_grades (task_id);

-- Down Migration
DROP TABLE IF EXISTS teacher_task_grades;
DROP TABLE IF EXISTS teacher_tasks;
DROP TABLE IF EXISTS teacher_exam_choices;
DROP TABLE IF EXISTS teacher_exam_questions;
DROP TABLE IF EXISTS teacher_exams;
DROP TABLE IF EXISTS teacher_lesson_attachments;
DROP TABLE IF EXISTS teacher_lessons;
DROP TYPE IF EXISTS teacher_exam_status;
DROP TYPE IF EXISTS teacher_exam_question_type;
DROP TYPE IF EXISTS teacher_attachment_kind;
