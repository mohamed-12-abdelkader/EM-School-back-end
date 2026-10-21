-- Up Migration
-- Epic 1.3: Family graph, guardians, clinic visits, behavior incidents

CREATE TABLE IF NOT EXISTS family_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_family_groups_tenant ON family_groups (tenant_id);

CREATE TABLE IF NOT EXISTS student_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  family_group_id UUID NOT NULL REFERENCES family_groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES mt_users(id) ON DELETE SET NULL,
  full_name VARCHAR(255) NOT NULL,
  relationship VARCHAR(50) NOT NULL DEFAULT 'PARENT',
  phone VARCHAR(50),
  email VARCHAR(255),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  has_custody BOOLEAN NOT NULL DEFAULT TRUE,
  is_financially_responsible BOOLEAN NOT NULL DEFAULT TRUE,
  is_emergency_contact BOOLEAN NOT NULL DEFAULT TRUE,
  can_pickup BOOLEAN NOT NULL DEFAULT TRUE,
  pickup_qr_token TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_guardians_tenant_family
  ON student_guardians (tenant_id, family_group_id);

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS mt_user_id UUID REFERENCES mt_users(id),
  ADD COLUMN IF NOT EXISTS grade_level_id UUID REFERENCES grade_levels(id),
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
  ADD COLUMN IF NOT EXISTS national_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Optional FK — skipped if orphan student rows exist from earlier scaffolding
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students s
    LEFT JOIN family_groups fg ON fg.id = s.family_group_id
    WHERE fg.id IS NULL
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_family_group_id_fkey
      FOREIGN KEY (family_group_id) REFERENCES family_groups(id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS clinic_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symptoms TEXT NOT NULL,
  treatment TEXT,
  nurse_notes TEXT,
  parent_contacted BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID REFERENCES mt_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_visits_tenant_student
  ON clinic_visits (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS behavior_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  incident_type VARCHAR(30) NOT NULL, -- MERIT | DEMERIT | DETENTION | COUNSELING | SUMMONS
  category VARCHAR(100),
  points INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  badge_code VARCHAR(50),
  parent_summons_required BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by UUID REFERENCES mt_users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_incidents_tenant_student
  ON behavior_incidents (tenant_id, student_id);

-- Down Migration
DROP TABLE IF EXISTS behavior_incidents;
DROP TABLE IF EXISTS clinic_visits;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_family_group_id_fkey;
ALTER TABLE students
  DROP COLUMN IF EXISTS mt_user_id,
  DROP COLUMN IF EXISTS grade_level_id,
  DROP COLUMN IF EXISTS date_of_birth,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS national_id,
  DROP COLUMN IF EXISTS updated_at;
DROP TABLE IF EXISTS student_guardians;
DROP TABLE IF EXISTS family_groups;
