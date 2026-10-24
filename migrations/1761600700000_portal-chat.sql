-- Up Migration
-- Student ↔ teacher in-app messaging for portals

CREATE TABLE IF NOT EXISTS portal_chat_threads (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_message TEXT,
  last_at TIMESTAMP NOT NULL DEFAULT NOW(),
  student_unread INTEGER NOT NULL DEFAULT 0,
  teacher_unread INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS portal_chat_threads_teacher_idx
  ON portal_chat_threads (teacher_id, last_at DESC);

CREATE INDEX IF NOT EXISTS portal_chat_threads_student_idx
  ON portal_chat_threads (student_id, last_at DESC);

CREATE TABLE IF NOT EXISTS portal_chat_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES portal_chat_threads (id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('student', 'teacher')),
  sender_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS portal_chat_messages_thread_idx
  ON portal_chat_messages (thread_id, created_at ASC);

-- Down Migration
DROP TABLE IF EXISTS portal_chat_messages;
DROP TABLE IF EXISTS portal_chat_threads;
