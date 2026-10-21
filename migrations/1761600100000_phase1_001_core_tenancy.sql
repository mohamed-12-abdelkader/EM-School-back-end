-- Up Migration
-- Epic 1.1: Core multi-tenancy — academic years, sections, mt_users, RBAC memberships

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE platform_role AS ENUM (
    'PLATFORM_SUPER_ADMIN',
    'GROUP_EXECUTIVE',
    'SCHOOL_ADMIN',
    'ADMISSIONS_OFFICER',
    'ACADEMIC_COORDINATOR',
    'FINANCE_MANAGER',
    'HR_SPECIALIST',
    'LIBRARIAN',
    'TRANSPORT_MANAGER',
    'TEACHER',
    'PARENT',
    'STUDENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mt_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(50) UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  refresh_jti TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mt_users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  age_cutoff_month SMALLINT NOT NULL DEFAULT 10,
  age_cutoff_day SMALLINT NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_academic_years_tenant ON academic_years (tenant_id);

CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  grade_level_id UUID NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  capacity SMALLINT NOT NULL DEFAULT 30,
  UNIQUE (tenant_id, grade_level_id, academic_year_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sections_tenant_branch ON sections (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS mt_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES mt_users(id) ON DELETE CASCADE,
  role platform_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, role, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_mt_memberships_tenant_user ON mt_memberships (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mt_memberships_user ON mt_memberships (user_id);

ALTER TABLE grade_levels
  ADD COLUMN IF NOT EXISTS min_age_years NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS max_age_years NUMERIC(4,2);

-- Down Migration
DROP TABLE IF EXISTS mt_memberships;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS academic_years;
DROP TABLE IF EXISTS mt_users;
DROP TYPE IF EXISTS platform_role;
