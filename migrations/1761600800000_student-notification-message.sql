-- Up Migration
-- Allow chat + timetable notifications for students

DO $$ BEGIN
  ALTER TYPE student_notification_kind ADD VALUE IF NOT EXISTS 'message';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE student_notification_kind ADD VALUE IF NOT EXISTS 'timetable';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Down Migration
-- Enum values cannot be removed safely in Postgres; left in place.
