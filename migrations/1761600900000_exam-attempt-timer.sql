-- Up Migration
-- Server-side exam timer: start records ends_at; submit may be null until finished

ALTER TABLE student_exam_attempts
  ALTER COLUMN submitted_at DROP NOT NULL;

ALTER TABLE student_exam_attempts
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS timed_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill ended attempts
UPDATE student_exam_attempts
SET ends_at = COALESCE(ends_at, submitted_at, started_at)
WHERE ends_at IS NULL;

-- Down Migration
ALTER TABLE student_exam_attempts DROP COLUMN IF EXISTS timed_out;
ALTER TABLE student_exam_attempts DROP COLUMN IF EXISTS ends_at;
-- submitted_at NOT NULL cannot be restored safely if nulls exist
