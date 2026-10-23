-- Up Migration
-- Formalize task submission modes: questions (in-platform) vs pdf (worksheet + student upload)

DO $$ BEGIN
  CREATE TYPE teacher_task_submission_mode AS ENUM ('questions', 'pdf');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE teacher_tasks
  ADD COLUMN IF NOT EXISTS submission_mode teacher_task_submission_mode NOT NULL DEFAULT 'questions';

-- Backfill from existing content
UPDATE teacher_tasks t
SET submission_mode = 'pdf'
WHERE deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM teacher_task_questions q WHERE q.task_id = t.id
  )
  AND EXISTS (
    SELECT 1 FROM teacher_task_attachments a WHERE a.task_id = t.id AND a.kind = 'pdf'
  );

ALTER TABLE teacher_task_grades
  ADD COLUMN IF NOT EXISTS submission_file_url TEXT,
  ADD COLUMN IF NOT EXISTS submission_filename TEXT;

CREATE INDEX IF NOT EXISTS teacher_task_grades_submitted_idx
  ON teacher_task_grades (task_id)
  WHERE submitted_at IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS teacher_task_grades_submitted_idx;
ALTER TABLE teacher_task_grades
  DROP COLUMN IF EXISTS submission_file_url,
  DROP COLUMN IF EXISTS submission_filename;
ALTER TABLE teacher_tasks
  DROP COLUMN IF EXISTS submission_mode;
DROP TYPE IF EXISTS teacher_task_submission_mode;
