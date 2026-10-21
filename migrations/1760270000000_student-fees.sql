-- Up Migration

CREATE TYPE fee_assignment_scope AS ENUM ('school', 'grade', 'students');

CREATE TYPE installment_status AS ENUM (
    'pending',
    'partial',
    'paid',
    'overdue',
    'cancelled'
);

CREATE TYPE payment_method AS ENUM (
    'cash',
    'bank_transfer',
    'card',
    'online',
    'other'
);

CREATE TYPE payment_status AS ENUM ('completed', 'reversed', 'refunded');

CREATE TYPE discount_type AS ENUM ('fixed', 'percent');

CREATE TABLE IF NOT EXISTS fee_categories (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_categories_school_name ON fee_categories (school_id, name)
WHERE
    deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fee_structures (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES fee_categories (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    academic_year TEXT NOT NULL,
    grade_id INTEGER REFERENCES grades (id) ON DELETE SET NULL,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    due_date DATE,
    assignment_scope fee_assignment_scope NOT NULL DEFAULT 'grade',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_school_year ON fee_structures (school_id, academic_year)
WHERE
    deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fee_structures_grade ON fee_structures (grade_id)
WHERE
    deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS student_fee_accounts (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EGP',
    total_fees NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_fees >= 0),
    total_discounts NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_discounts >= 0),
    total_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
    total_refunded NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_refunded >= 0),
    balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
    overdue_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (overdue_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (school_id, student_id, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_fee_accounts_student ON student_fee_accounts (student_id);

CREATE INDEX IF NOT EXISTS idx_fee_accounts_school_year ON student_fee_accounts (school_id, academic_year);

CREATE TABLE IF NOT EXISTS student_fee_items (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES student_fee_accounts (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    fee_structure_id INTEGER REFERENCES fee_structures (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    original_amount NUMERIC(12, 2) NOT NULL CHECK (original_amount >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    net_amount NUMERIC(12, 2) NOT NULL CHECK (net_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    due_date DATE,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    cancelled_at TIMESTAMPTZ,
    cancelled_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    cancel_reason TEXT,
    CONSTRAINT student_fee_items_amounts_check CHECK (
        discount_amount <= original_amount
        AND paid_amount <= net_amount + 0.01
    )
);

CREATE INDEX IF NOT EXISTS idx_fee_items_account ON student_fee_items (account_id)
WHERE
    cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_fee_items_student ON student_fee_items (student_id)
WHERE
    cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS installment_plans (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES student_fee_accounts (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title TEXT,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    installment_count INTEGER NOT NULL CHECK (installment_count > 0),
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_installment_plans_account ON installment_plans (account_id)
WHERE
    cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS installments (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES installment_plans (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES student_fee_accounts (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
    title TEXT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    due_date DATE NOT NULL,
    status installment_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    cancelled_at TIMESTAMPTZ,
    UNIQUE (plan_id, sequence_no),
    CONSTRAINT installments_paid_check CHECK (paid_amount <= amount + 0.01)
);

CREATE INDEX IF NOT EXISTS idx_installments_account_due ON installments (account_id, due_date)
WHERE
    cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_installments_school_status ON installments (school_id, status, due_date)
WHERE
    cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES student_fee_accounts (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method payment_method NOT NULL DEFAULT 'cash',
    status payment_status NOT NULL DEFAULT 'completed',
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    reference TEXT,
    notes TEXT,
    idempotency_key TEXT,
    recorded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (school_id, receipt_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON payments (school_id, idempotency_key)
WHERE
    idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_account ON payments (account_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_school_date ON payments (school_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    payment_id INTEGER NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
    installment_id INTEGER REFERENCES installments (id) ON DELETE SET NULL,
    fee_item_id INTEGER REFERENCES student_fee_items (id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_installment ON payment_allocations (installment_id);

CREATE TABLE IF NOT EXISTS fee_discounts (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES student_fee_accounts (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    fee_item_id INTEGER REFERENCES student_fee_items (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    discount_type discount_type NOT NULL,
    value NUMERIC(12, 2) NOT NULL CHECK (value > 0),
    amount_applied NUMERIC(12, 2) NOT NULL CHECK (amount_applied >= 0),
    reason TEXT,
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    approved_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fee_discounts_account ON fee_discounts (account_id)
WHERE
    cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS fee_refunds (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES student_fee_accounts (id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    payment_id INTEGER REFERENCES payments (id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    recorded_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_fee_refunds_account ON fee_refunds (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS financial_audit_logs (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    student_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    changed_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW ()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_school ON financial_audit_logs (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_audit_entity ON financial_audit_logs (entity_type, entity_id);

-- Down Migration
DROP INDEX IF EXISTS idx_financial_audit_entity;

DROP INDEX IF EXISTS idx_financial_audit_school;

DROP TABLE IF EXISTS financial_audit_logs;

DROP INDEX IF EXISTS idx_fee_refunds_account;

DROP TABLE IF EXISTS fee_refunds;

DROP INDEX IF EXISTS idx_fee_discounts_account;

DROP TABLE IF EXISTS fee_discounts;

DROP INDEX IF EXISTS idx_payment_allocations_installment;

DROP INDEX IF EXISTS idx_payment_allocations_payment;

DROP TABLE IF EXISTS payment_allocations;

DROP INDEX IF EXISTS idx_payments_school_date;

DROP INDEX IF EXISTS idx_payments_account;

DROP INDEX IF EXISTS idx_payments_idempotency;

DROP TABLE IF EXISTS payments;

DROP INDEX IF EXISTS idx_installments_school_status;

DROP INDEX IF EXISTS idx_installments_account_due;

DROP TABLE IF EXISTS installments;

DROP INDEX IF EXISTS idx_installment_plans_account;

DROP TABLE IF EXISTS installment_plans;

DROP INDEX IF EXISTS idx_fee_items_student;

DROP INDEX IF EXISTS idx_fee_items_account;

DROP TABLE IF EXISTS student_fee_items;

DROP INDEX IF EXISTS idx_fee_accounts_school_year;

DROP INDEX IF EXISTS idx_fee_accounts_student;

DROP TABLE IF EXISTS student_fee_accounts;

DROP INDEX IF EXISTS idx_fee_structures_grade;

DROP INDEX IF EXISTS idx_fee_structures_school_year;

DROP TABLE IF EXISTS fee_structures;

DROP INDEX IF EXISTS idx_fee_categories_school_name;

DROP TABLE IF EXISTS fee_categories;

DROP TYPE IF EXISTS discount_type;

DROP TYPE IF EXISTS payment_status;

DROP TYPE IF EXISTS payment_method;

DROP TYPE IF EXISTS installment_status;

DROP TYPE IF EXISTS fee_assignment_scope;
