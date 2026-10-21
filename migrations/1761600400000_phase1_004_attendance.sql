-- Up Migration
-- Epic 1.4: Bell schedules, gate dismissals, notification outbox

CREATE TABLE IF NOT EXISTS bell_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL DEFAULT 'Default',
  day_of_week SMALLINT, -- NULL = all days; 0=Sun .. 6=Sat
  morning_start TIME NOT NULL DEFAULT '07:30',
  late_after TIME NOT NULL DEFAULT '08:00',
  period_ends JSONB NOT NULL DEFAULT '[]', -- [{period:1, end:"08:45"}, ...]
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, branch_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bell_schedules_tenant_branch
  ON bell_schedules (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS gate_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  student_id UUID NOT NULL REFERENCES students(id),
  guardian_id UUID REFERENCES student_guardians(id),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method VARCHAR(30) NOT NULL DEFAULT 'QR_PICKUP', -- QR_PICKUP | STAFF_OVERRIDE
  verified_by UUID REFERENCES mt_users(id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_gate_dismissals_tenant_date
  ON gate_dismissals (tenant_id, dismissed_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel VARCHAR(30) NOT NULL, -- PUSH | WHATSAPP | SMS
  recipient VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | SENT | FAILED | ACKED
  related_type VARCHAR(50),
  related_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_tenant_status
  ON notification_outbox (tenant_id, status);

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES mt_users(id),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_student
  ON attendance_logs (tenant_id, student_id);

-- Down Migration
ALTER TABLE attendance_logs
  DROP COLUMN IF EXISTS recorded_by,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS created_at;
DROP TABLE IF EXISTS notification_outbox;
DROP TABLE IF EXISTS gate_dismissals;
DROP TABLE IF EXISTS bell_schedules;
