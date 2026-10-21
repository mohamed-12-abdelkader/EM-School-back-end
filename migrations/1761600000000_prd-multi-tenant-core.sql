-- Up Migration
-- PRD §5 Phase 1: Multi-tenant core, admissions, students, attendance

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE k12_stage AS ENUM ('KINDERGARTEN', 'ELEMENTARY', 'PREPARATORY', 'SECONDARY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE grading_scale_type AS ENUM ('RUBRIC', 'PERCENTAGE_WEIGHTED', 'GPA_CREDIT', 'LETTER_BAND');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  subscription_plan VARCHAR(50) NOT NULL DEFAULT 'ENTERPRISE',
  quota_max_students INT NOT NULL DEFAULT 2000,
  enabled_modules JSONB NOT NULL DEFAULT '["SIS","LMS","FINANCE","HR","TRANSPORT","LIBRARY"]',
  settings JSONB NOT NULL DEFAULT '{"lock_report_card_on_arrears": true, "quiet_hours": {"start": "17:00", "end": "07:30"}}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(30) NOT NULL,
  address TEXT,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Africa/Cairo',
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant_id ON branches (tenant_id);

CREATE TABLE IF NOT EXISTS academic_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  grading_type grading_scale_type NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_academic_streams_tenant_id ON academic_streams (tenant_id);

CREATE TABLE IF NOT EXISTS grade_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  stream_id UUID NOT NULL REFERENCES academic_streams(id),
  stage k12_stage NOT NULL,
  name VARCHAR(100) NOT NULL,
  sequence_order SMALLINT NOT NULL,
  attendance_mode VARCHAR(20) NOT NULL DEFAULT 'DAILY'
);

CREATE INDEX IF NOT EXISTS idx_grade_levels_tenant_id ON grade_levels (tenant_id);

CREATE TABLE IF NOT EXISTS admission_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  academic_year_id UUID NOT NULL,
  target_grade_id UUID NOT NULL REFERENCES grade_levels(id),
  applicant_full_name VARCHAR(255) NOT NULL,
  date_of_birth DATE NOT NULL,
  guardian_details JSONB NOT NULL,
  documents JSONB NOT NULL DEFAULT '[]',
  entrance_exam_slot TIMESTAMPTZ,
  entrance_exam_score NUMERIC(5,2),
  status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  waitlist_rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admission_applications_tenant_id ON admission_applications (tenant_id);

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  user_id INTEGER REFERENCES users(id),
  family_group_id UUID NOT NULL,
  student_code VARCHAR(50) NOT NULL,
  rfid_card_uid VARCHAR(100),
  biometric_device_user_id VARCHAR(50),
  full_name VARCHAR(255) NOT NULL,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  current_section_id UUID,
  medical_profile JSONB NOT NULL DEFAULT '{"allergies": [], "conditions": [], "emergency_notes": ""}',
  disciplinary_points INT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, student_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_tenant_rfid
  ON students (tenant_id, rfid_card_uid)
  WHERE rfid_card_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_students_tenant_id ON students (tenant_id);
CREATE INDEX IF NOT EXISTS idx_students_family_group ON students (tenant_id, family_group_id);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id),
  section_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  period_number SMALLINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'MOBILE_APP',
  check_in_at TIMESTAMPTZ,
  late_minutes SMALLINT DEFAULT 0,
  UNIQUE (tenant_id, student_id, attendance_date, period_number)
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_date
  ON attendance_logs (tenant_id, attendance_date);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships (user_id);

-- Down Migration
DROP TABLE IF EXISTS tenant_memberships;
DROP TABLE IF EXISTS attendance_logs;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS admission_applications;
DROP TABLE IF EXISTS grade_levels;
DROP TABLE IF EXISTS academic_streams;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS tenants;
DROP TYPE IF EXISTS grading_scale_type;
DROP TYPE IF EXISTS k12_stage;
