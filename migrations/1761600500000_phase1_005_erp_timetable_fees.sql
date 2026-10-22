-- Up Migration
-- Phase 1.5 ERP: tenant-scoped timetable + fees/installments (product core)

CREATE TABLE IF NOT EXISTS erp_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(40),
  color VARCHAR(20) NOT NULL DEFAULT '#4F46E5',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_erp_subjects_tenant ON erp_subjects (tenant_id);

CREATE TABLE IF NOT EXISTS erp_timetable_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  working_days SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4],
  periods_per_day SMALLINT NOT NULL DEFAULT 7 CHECK (periods_per_day BETWEEN 1 AND 12),
  period_minutes SMALLINT NOT NULL DEFAULT 45 CHECK (period_minutes BETWEEN 20 AND 120),
  day_start_time TIME NOT NULL DEFAULT '08:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_timetables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  title VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES mt_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, section_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_erp_timetables_tenant ON erp_timetables (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS erp_timetable_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  timetable_id UUID NOT NULL REFERENCES erp_timetables(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 12),
  subject_id UUID REFERENCES erp_subjects(id) ON DELETE SET NULL,
  teacher_name VARCHAR(200),
  room VARCHAR(80),
  slot_type VARCHAR(20) NOT NULL DEFAULT 'lesson' CHECK (slot_type IN ('lesson', 'break', 'activity')),
  notes TEXT,
  UNIQUE (timetable_id, day_of_week, period_number)
);

CREATE INDEX IF NOT EXISTS idx_erp_slots_timetable ON erp_timetable_slots (timetable_id);

CREATE TABLE IF NOT EXISTS erp_fee_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS erp_fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES erp_fee_categories(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  grade_level_id UUID REFERENCES grade_levels(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'EGP',
  installment_count SMALLINT NOT NULL DEFAULT 1 CHECK (installment_count BETWEEN 1 AND 24),
  is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  due_date DATE,
  created_by UUID REFERENCES mt_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_fee_structures_tenant ON erp_fee_structures (tenant_id);

CREATE TABLE IF NOT EXISTS erp_fee_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'EGP',
  total_fees NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
  overdue_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_erp_fee_accounts_tenant ON erp_fee_accounts (tenant_id);

CREATE TABLE IF NOT EXISTS erp_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES erp_fee_accounts(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_structure_id UUID REFERENCES erp_fee_structures(id) ON DELETE SET NULL,
  label VARCHAR(120) NOT NULL,
  sequence_no SMALLINT NOT NULL DEFAULT 1,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_installments_tenant_status
  ON erp_installments (tenant_id, status, due_date);

CREATE TABLE IF NOT EXISTS erp_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES erp_fee_accounts(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES erp_installments(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  method VARCHAR(30) NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'bank_transfer', 'card', 'online', 'other')),
  reference VARCHAR(120),
  notes TEXT,
  received_by UUID REFERENCES mt_users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_payments_tenant ON erp_payments (tenant_id, paid_at DESC);

-- Ensure FINANCE stays available for existing tenants
UPDATE tenants
SET enabled_modules = enabled_modules || '["FINANCE"]'::jsonb
WHERE NOT (enabled_modules ? 'FINANCE');

-- Down Migration
DROP TABLE IF EXISTS erp_payments;
DROP TABLE IF EXISTS erp_installments;
DROP TABLE IF EXISTS erp_fee_accounts;
DROP TABLE IF EXISTS erp_fee_structures;
DROP TABLE IF EXISTS erp_fee_categories;
DROP TABLE IF EXISTS erp_timetable_slots;
DROP TABLE IF EXISTS erp_timetables;
DROP TABLE IF EXISTS erp_timetable_settings;
DROP TABLE IF EXISTS erp_subjects;
