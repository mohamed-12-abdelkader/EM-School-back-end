-- Up Migration
-- Epic 1.2: Admissions pipeline, seat quotas, document verification

CREATE TABLE IF NOT EXISTS grade_seat_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_level_id UUID NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  max_seats INT NOT NULL,
  enrolled_count INT NOT NULL DEFAULT 0,
  waitlist_count INT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, academic_year_id, grade_level_id)
);

CREATE INDEX IF NOT EXISTS idx_grade_seat_quotas_tenant_branch
  ON grade_seat_quotas (tenant_id, branch_id);

ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS family_group_id UUID,
  ADD COLUMN IF NOT EXISTS proctor_user_id UUID REFERENCES mt_users(id),
  ADD COLUMN IF NOT EXISTS interview_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS enrolled_student_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_admission_applications_tenant_status
  ON admission_applications (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_admission_applications_tenant_branch
  ON admission_applications (tenant_id, branch_id);

-- Down Migration
ALTER TABLE admission_applications
  DROP COLUMN IF EXISTS family_group_id,
  DROP COLUMN IF EXISTS proctor_user_id,
  DROP COLUMN IF EXISTS interview_score,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS enrolled_student_id,
  DROP COLUMN IF EXISTS updated_at;

DROP TABLE IF EXISTS grade_seat_quotas;
