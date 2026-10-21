import { PoolClient } from 'pg';
import pool from '../db/pool';
import { HttpError } from '../utils';
import {
  moneyAdd,
  moneyEq,
  moneyGt,
  moneyGte,
  moneyLt,
  moneyLte,
  moneyMin,
  moneySub,
  percentOf,
  roundMoney,
  splitEqually,
  toCents,
} from './money';

type Client = PoolClient;

async function audit(
  client: Client,
  params: {
    schoolId: number;
    entityType: string;
    entityId: number;
    action: string;
    studentId?: number | null;
    oldValues?: unknown;
    newValues?: unknown;
    reason?: string | null;
    changedBy?: number | null;
  },
) {
  await client.query(
    `INSERT INTO financial_audit_logs
       (school_id, entity_type, entity_id, action, student_id, old_values, new_values, reason, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
    [
      params.schoolId,
      params.entityType,
      params.entityId,
      params.action,
      params.studentId ?? null,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      params.reason ?? null,
      params.changedBy ?? null,
    ],
  );
}

export async function assertSchoolStudent(schoolId: number, studentId: number) {
  const result = await pool.query(
    `SELECT u.id, u.name, sp.grade_id, sp.academic_year, sp.classroom_id
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'student' AND u.deleted_at IS NULL`,
    [studentId, schoolId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Student not found in your school');
  return result.rows[0];
}

export function deriveInstallmentStatus(amount: number, paid: number, dueDate: string): string {
  if (moneyGte(paid, amount)) return 'paid';
  if (moneyGt(paid, 0)) {
    const today = new Date().toISOString().slice(0, 10);
    return dueDate < today ? 'overdue' : 'partial';
  }
  const today = new Date().toISOString().slice(0, 10);
  return dueDate < today ? 'overdue' : 'pending';
}

export async function refreshAccountTotals(client: Client, accountId: number) {
  const items = await client.query(
    `SELECT
       COALESCE(SUM(original_amount),0)::float8 AS total_fees,
       COALESCE(SUM(discount_amount),0)::float8 AS total_discounts,
       COALESCE(SUM(paid_amount),0)::float8 AS items_paid
     FROM student_fee_items
     WHERE account_id = $1 AND cancelled_at IS NULL`,
    [accountId],
  );

  const payments = await client.query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS total_paid
     FROM payments
     WHERE account_id = $1 AND status = 'completed'`,
    [accountId],
  );

  const refunds = await client.query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS total_refunded
     FROM fee_refunds WHERE account_id = $1`,
    [accountId],
  );

  // Refresh installment statuses based on due dates / paid amounts
  const installments = await client.query(
    `SELECT id, amount::float8 AS amount, paid_amount::float8 AS paid_amount, due_date::text AS due_date
     FROM installments
     WHERE account_id = $1 AND cancelled_at IS NULL`,
    [accountId],
  );
  for (const row of installments.rows) {
    const status = deriveInstallmentStatus(row.amount, row.paid_amount, row.due_date.slice(0, 10));
    await client.query(`UPDATE installments SET status = $1, updated_at = NOW() WHERE id = $2`, [
      status,
      row.id,
    ]);
  }

  const overdue = await client.query(
    `SELECT COALESCE(SUM(amount - paid_amount),0)::float8 AS overdue_amount
     FROM installments
     WHERE account_id = $1 AND cancelled_at IS NULL
       AND status IN ('overdue', 'partial', 'pending')
       AND due_date < CURRENT_DATE
       AND paid_amount < amount`,
    [accountId],
  );

  const totalFees = roundMoney(items.rows[0].total_fees);
  const totalDiscounts = roundMoney(items.rows[0].total_discounts);
  const totalPaid = roundMoney(payments.rows[0].total_paid);
  const totalRefunded = roundMoney(refunds.rows[0].total_refunded);
  const netDue = moneySub(moneySub(totalFees, totalDiscounts), moneySub(totalPaid, totalRefunded));
  const balanceDue = moneyLt(netDue, 0) ? 0 : netDue;

  await client.query(
    `UPDATE student_fee_accounts
     SET total_fees = $1,
         total_discounts = $2,
         total_paid = $3,
         total_refunded = $4,
         balance_due = $5,
         overdue_amount = $6,
         updated_at = NOW()
     WHERE id = $7`,
    [
      totalFees,
      totalDiscounts,
      totalPaid,
      totalRefunded,
      balanceDue,
      roundMoney(overdue.rows[0].overdue_amount),
      accountId,
    ],
  );
}

export async function getOrCreateAccount(
  client: Client,
  params: { schoolId: number; studentId: number; academicYear: string },
) {
  const existing = await client.query(
    `SELECT * FROM student_fee_accounts
     WHERE school_id = $1 AND student_id = $2 AND academic_year = $3
     FOR UPDATE`,
    [params.schoolId, params.studentId, params.academicYear],
  );
  if (existing.rowCount) return existing.rows[0];

  const inserted = await client.query(
    `INSERT INTO student_fee_accounts (school_id, student_id, academic_year)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [params.schoolId, params.studentId, params.academicYear],
  );
  return inserted.rows[0];
}

export async function assignFeeToStudent(params: {
  schoolId: number;
  studentId: number;
  academicYear: string;
  feeStructureId?: number | null;
  name: string;
  description?: string | null;
  amount: number;
  dueDate?: string | null;
  isMandatory?: boolean;
  actorId: number;
}) {
  await assertSchoolStudent(params.schoolId, params.studentId);
  if (moneyLt(params.amount, 0)) throw new HttpError(400, 'Amount cannot be negative');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await getOrCreateAccount(client, {
      schoolId: params.schoolId,
      studentId: params.studentId,
      academicYear: params.academicYear,
    });

    const amount = roundMoney(params.amount);
    const inserted = await client.query(
      `INSERT INTO student_fee_items
         (school_id, account_id, student_id, fee_structure_id, name, description,
          original_amount, discount_amount, net_amount, due_date, is_mandatory, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7,$8,$9,$10)
       RETURNING *`,
      [
        params.schoolId,
        account.id,
        params.studentId,
        params.feeStructureId ?? null,
        params.name,
        params.description ?? null,
        amount,
        params.dueDate ?? null,
        params.isMandatory ?? true,
        params.actorId,
      ],
    );

    await refreshAccountTotals(client, account.id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'student_fee_item',
      entityId: inserted.rows[0].id,
      action: 'create',
      studentId: params.studentId,
      newValues: inserted.rows[0],
      changedBy: params.actorId,
    });

    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function applyFeeStructureToTargets(params: {
  schoolId: number;
  feeStructureId: number;
  studentIds?: number[];
  actorId: number;
}) {
  const structure = await pool.query(
    `SELECT * FROM fee_structures
     WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL AND is_active = TRUE`,
    [params.feeStructureId, params.schoolId],
  );
  if (!structure.rowCount) throw new HttpError(404, 'Fee structure not found');
  const fee = structure.rows[0];

  let studentIds = params.studentIds || [];
  if (!studentIds.length) {
    if (fee.assignment_scope === 'grade' && fee.grade_id) {
      const rows = await pool.query(
        `SELECT u.id FROM users u
         JOIN student_profiles sp ON sp.user_id = u.id
         WHERE u.school_id = $1 AND u.role = 'student' AND u.deleted_at IS NULL
           AND sp.status = 'active' AND sp.grade_id = $2 AND sp.academic_year = $3`,
        [params.schoolId, fee.grade_id, fee.academic_year],
      );
      studentIds = rows.rows.map((r) => r.id);
    } else if (fee.assignment_scope === 'school') {
      const rows = await pool.query(
        `SELECT u.id FROM users u
         JOIN student_profiles sp ON sp.user_id = u.id
         WHERE u.school_id = $1 AND u.role = 'student' AND u.deleted_at IS NULL
           AND sp.status = 'active' AND sp.academic_year = $2`,
        [params.schoolId, fee.academic_year],
      );
      studentIds = rows.rows.map((r) => r.id);
    } else {
      throw new HttpError(400, 'student_ids are required for this fee assignment scope');
    }
  }

  const created: unknown[] = [];
  for (const studentId of studentIds) {
    const item = await assignFeeToStudent({
      schoolId: params.schoolId,
      studentId,
      academicYear: fee.academic_year,
      feeStructureId: fee.id,
      name: fee.name,
      description: fee.description,
      amount: Number(fee.amount),
      dueDate: fee.due_date,
      isMandatory: fee.is_mandatory,
      actorId: params.actorId,
    });
    created.push(item);
  }

  return { assigned_count: created.length, items: created };
}

export async function createInstallmentPlan(params: {
  schoolId: number;
  studentId: number;
  academicYear: string;
  title?: string | null;
  amounts?: number[];
  count?: number;
  totalAmount?: number;
  firstDueDate: string;
  intervalDays?: number;
  dueDates?: string[];
  actorId: number;
}) {
  await assertSchoolStudent(params.schoolId, params.studentId);

  let amounts = params.amounts;
  if (!amounts || !amounts.length) {
    if (!params.count || params.count < 1 || params.totalAmount == null) {
      throw new HttpError(400, 'Provide amounts[] or count + total_amount');
    }
    amounts = splitEqually(params.totalAmount, params.count);
  }

  const total = roundMoney(amounts.reduce((s, a) => moneyAdd(s, a), 0));
  if (params.totalAmount != null && !moneyEq(total, params.totalAmount)) {
    // allow small float input differences after splitEqually
    if (Math.abs(toCents(total) - toCents(params.totalAmount)) > 1) {
      throw new HttpError(400, 'Sum of installment amounts must equal total_amount');
    }
  }

  const dueDates =
    params.dueDates && params.dueDates.length === amounts.length
      ? params.dueDates
      : amounts.map((_, i) => {
          const d = new Date(params.firstDueDate + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + i * (params.intervalDays ?? 30));
          return d.toISOString().slice(0, 10);
        });

  if (dueDates.length !== amounts.length) {
    throw new HttpError(400, 'due_dates length must match installments count');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await getOrCreateAccount(client, {
      schoolId: params.schoolId,
      studentId: params.studentId,
      academicYear: params.academicYear,
    });
    await refreshAccountTotals(client, account.id);
    const freshAccount = await client.query(
      `SELECT * FROM student_fee_accounts WHERE id = $1 FOR UPDATE`,
      [account.id],
    );
    const maxSchedulable = moneySub(
      moneySub(freshAccount.rows[0].total_fees, freshAccount.rows[0].total_discounts),
      moneySub(freshAccount.rows[0].total_paid, freshAccount.rows[0].total_refunded),
    );
    // Existing open installments already schedule part of the liability
    const openInst = await client.query(
      `SELECT COALESCE(SUM(amount - paid_amount),0)::float8 AS open_amount
       FROM installments
       WHERE account_id = $1 AND cancelled_at IS NULL AND paid_amount < amount`,
      [account.id],
    );
    const remainingSchedulable = moneySub(maxSchedulable, openInst.rows[0].open_amount);
    if (moneyGt(total, remainingSchedulable) && moneyGte(remainingSchedulable, 0)) {
      throw new HttpError(
        400,
        `Installment total (${total}) exceeds remaining schedulable amount (${remainingSchedulable})`,
      );
    }

    const plan = await client.query(
      `INSERT INTO installment_plans
         (school_id, account_id, student_id, title, total_amount, installment_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        params.schoolId,
        account.id,
        params.studentId,
        params.title ?? null,
        total,
        amounts.length,
        params.actorId,
      ],
    );

    const installments = [];
    for (let i = 0; i < amounts.length; i++) {
      const amount = roundMoney(amounts[i]);
      const status = deriveInstallmentStatus(amount, 0, dueDates[i]);
      const row = await client.query(
        `INSERT INTO installments
           (school_id, plan_id, account_id, student_id, sequence_no, title, amount, due_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          params.schoolId,
          plan.rows[0].id,
          account.id,
          params.studentId,
          i + 1,
          `قسط ${i + 1}`,
          amount,
          dueDates[i],
          status,
        ],
      );
      installments.push(row.rows[0]);
    }

    await refreshAccountTotals(client, account.id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'installment_plan',
      entityId: plan.rows[0].id,
      action: 'create',
      studentId: params.studentId,
      newValues: { plan: plan.rows[0], installments },
      changedBy: params.actorId,
    });

    await client.query('COMMIT');
    return { plan: plan.rows[0], installments };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function nextReceiptNumber(client: Client, schoolId: number): Promise<string> {
  const year = new Date().getFullYear();
  for (let i = 0; i < 8; i++) {
    const seq = await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM payments WHERE school_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
      [schoolId, year],
    );
    const candidate = `R-${year}-${String(seq.rows[0].n + i).padStart(6, '0')}`;
    const exists = await client.query(
      `SELECT 1 FROM payments WHERE school_id = $1 AND receipt_number = $2`,
      [schoolId, candidate],
    );
    if (!exists.rowCount) return candidate;
  }
  return `R-${year}-${Date.now()}`;
}

export async function recordPayment(params: {
  schoolId: number;
  studentId: number;
  academicYear: string;
  amount: number;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  installmentIds?: number[];
  idempotencyKey?: string | null;
  actorId: number;
}) {
  await assertSchoolStudent(params.schoolId, params.studentId);
  const amount = roundMoney(params.amount);
  if (!moneyGt(amount, 0)) throw new HttpError(400, 'Payment amount must be greater than zero');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (params.idempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM payments WHERE school_id = $1 AND idempotency_key = $2`,
        [params.schoolId, params.idempotencyKey],
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return { payment: existing.rows[0], allocations: [], idempotent_replay: true };
      }
    }

    const account = await getOrCreateAccount(client, {
      schoolId: params.schoolId,
      studentId: params.studentId,
      academicYear: params.academicYear,
    });

    // Optional: prevent overpayment beyond balance + small tolerance unless prepaid wanted
    // Spec allows rejecting overpayment unless prepaid supported — we allow prepaid (balance can go conceptually via paid > net)
    const receipt = await nextReceiptNumber(client, params.schoolId);

    const payment = await client.query(
      `INSERT INTO payments
         (school_id, account_id, student_id, receipt_number, amount, method, reference, notes,
          idempotency_key, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        params.schoolId,
        account.id,
        params.studentId,
        receipt,
        amount,
        params.method || 'cash',
        params.reference ?? null,
        params.notes ?? null,
        params.idempotencyKey ?? null,
        params.actorId,
      ],
    );

    // Load installments to allocate: explicit list or oldest due first
    let installmentsQuery;
    if (params.installmentIds?.length) {
      installmentsQuery = await client.query(
        `SELECT * FROM installments
         WHERE account_id = $1 AND school_id = $2 AND cancelled_at IS NULL
           AND id = ANY($3::int[]) AND paid_amount < amount
         ORDER BY due_date ASC, sequence_no ASC
         FOR UPDATE`,
        [account.id, params.schoolId, params.installmentIds],
      );
    } else {
      installmentsQuery = await client.query(
        `SELECT * FROM installments
         WHERE account_id = $1 AND school_id = $2 AND cancelled_at IS NULL
           AND paid_amount < amount AND status <> 'cancelled'
         ORDER BY due_date ASC, sequence_no ASC
         FOR UPDATE`,
        [account.id, params.schoolId],
      );
    }

    let remaining = amount;
    const allocations = [];
    for (const inst of installmentsQuery.rows) {
      if (!moneyGt(remaining, 0)) break;
      const dueLeft = moneySub(inst.amount, inst.paid_amount);
      if (!moneyGt(dueLeft, 0)) continue;
      const apply = moneyMin(remaining, dueLeft);
      await client.query(
        `INSERT INTO payment_allocations (school_id, payment_id, installment_id, amount)
         VALUES ($1,$2,$3,$4)`,
        [params.schoolId, payment.rows[0].id, inst.id, apply],
      );
      const newPaid = moneyAdd(inst.paid_amount, apply);
      const status = deriveInstallmentStatus(Number(inst.amount), newPaid, String(inst.due_date).slice(0, 10));
      await client.query(
        `UPDATE installments SET paid_amount = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [newPaid, status, inst.id],
      );
      allocations.push({ installment_id: inst.id, amount: apply });
      remaining = moneySub(remaining, apply);
    }

    // Allocate leftover to fee items (oldest due) if any
    if (moneyGt(remaining, 0)) {
      const items = await client.query(
        `SELECT * FROM student_fee_items
         WHERE account_id = $1 AND cancelled_at IS NULL AND paid_amount < net_amount
         ORDER BY COALESCE(due_date, created_at::date) ASC, id ASC
         FOR UPDATE`,
        [account.id],
      );
      for (const item of items.rows) {
        if (!moneyGt(remaining, 0)) break;
        const left = moneySub(item.net_amount, item.paid_amount);
        if (!moneyGt(left, 0)) continue;
        const apply = moneyMin(remaining, left);
        await client.query(
          `INSERT INTO payment_allocations (school_id, payment_id, fee_item_id, amount)
           VALUES ($1,$2,$3,$4)`,
          [params.schoolId, payment.rows[0].id, item.id, apply],
        );
        await client.query(
          `UPDATE student_fee_items SET paid_amount = $1, updated_at = NOW() WHERE id = $2`,
          [moneyAdd(item.paid_amount, apply), item.id],
        );
        allocations.push({ fee_item_id: item.id, amount: apply });
        remaining = moneySub(remaining, apply);
      }
    }

    // Any still remaining is prepaid credit reflected via total_paid > allocated items
    await refreshAccountTotals(client, account.id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'payment',
      entityId: payment.rows[0].id,
      action: 'create',
      studentId: params.studentId,
      newValues: { payment: payment.rows[0], allocations, unallocated: remaining },
      changedBy: params.actorId,
    });

    await client.query('COMMIT');
    return {
      payment: payment.rows[0],
      allocations,
      unallocated: remaining,
      idempotent_replay: false,
    };
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505' && params.idempotencyKey) {
      const existing = await pool.query(
        `SELECT * FROM payments WHERE school_id = $1 AND idempotency_key = $2`,
        [params.schoolId, params.idempotencyKey],
      );
      if (existing.rowCount) {
        return { payment: existing.rows[0], allocations: [], idempotent_replay: true };
      }
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function applyDiscount(params: {
  schoolId: number;
  studentId: number;
  academicYear: string;
  feeItemId?: number | null;
  name: string;
  discountType: 'fixed' | 'percent';
  value: number;
  reason?: string | null;
  actorId: number;
}) {
  await assertSchoolStudent(params.schoolId, params.studentId);
  if (!moneyGt(params.value, 0)) throw new HttpError(400, 'Discount value must be > 0');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await getOrCreateAccount(client, {
      schoolId: params.schoolId,
      studentId: params.studentId,
      academicYear: params.academicYear,
    });

    let feeItemId = params.feeItemId ?? null;
    let amountApplied = 0;

    if (feeItemId) {
      const item = await client.query(
        `SELECT * FROM student_fee_items
         WHERE id = $1 AND account_id = $2 AND cancelled_at IS NULL FOR UPDATE`,
        [feeItemId, account.id],
      );
      if (!item.rowCount) throw new HttpError(404, 'Fee item not found');
      const row = item.rows[0];
      const available = moneySub(row.net_amount, row.paid_amount);
      amountApplied =
        params.discountType === 'percent'
          ? percentOf(row.net_amount, params.value)
          : roundMoney(params.value);
      if (moneyGt(amountApplied, available)) {
        throw new HttpError(400, 'Discount exceeds remaining fee item amount');
      }
      const newDiscount = moneyAdd(row.discount_amount, amountApplied);
      const newNet = moneySub(row.original_amount, newDiscount);
      await client.query(
        `UPDATE student_fee_items
         SET discount_amount = $1, net_amount = $2, updated_at = NOW()
         WHERE id = $3`,
        [newDiscount, newNet, feeItemId],
      );
    } else {
      // Apply to account by creating a virtual discount against first unpaid item
      const item = await client.query(
        `SELECT * FROM student_fee_items
         WHERE account_id = $1 AND cancelled_at IS NULL AND paid_amount < net_amount
         ORDER BY id ASC LIMIT 1 FOR UPDATE`,
        [account.id],
      );
      if (!item.rowCount) throw new HttpError(400, 'No fee items available for discount');
      feeItemId = item.rows[0].id;
      const row = item.rows[0];
      const available = moneySub(row.net_amount, row.paid_amount);
      amountApplied =
        params.discountType === 'percent'
          ? percentOf(row.net_amount, params.value)
          : roundMoney(params.value);
      if (moneyGt(amountApplied, available)) {
        throw new HttpError(400, 'Discount exceeds remaining fee item amount');
      }
      const newDiscount = moneyAdd(row.discount_amount, amountApplied);
      const newNet = moneySub(row.original_amount, newDiscount);
      await client.query(
        `UPDATE student_fee_items
         SET discount_amount = $1, net_amount = $2, updated_at = NOW()
         WHERE id = $3`,
        [newDiscount, newNet, feeItemId],
      );
    }

    const discount = await client.query(
      `INSERT INTO fee_discounts
         (school_id, account_id, student_id, fee_item_id, name, discount_type, value,
          amount_applied, reason, created_by, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        params.schoolId,
        account.id,
        params.studentId,
        feeItemId,
        params.name,
        params.discountType,
        roundMoney(params.value),
        amountApplied,
        params.reason ?? null,
        params.actorId,
      ],
    );

    await refreshAccountTotals(client, account.id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'fee_discount',
      entityId: discount.rows[0].id,
      action: 'create',
      studentId: params.studentId,
      newValues: discount.rows[0],
      reason: params.reason,
      changedBy: params.actorId,
    });

    await client.query('COMMIT');
    return discount.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function recordRefund(params: {
  schoolId: number;
  studentId: number;
  academicYear: string;
  paymentId?: number | null;
  amount: number;
  reason: string;
  actorId: number;
}) {
  await assertSchoolStudent(params.schoolId, params.studentId);
  const amount = roundMoney(params.amount);
  if (!moneyGt(amount, 0)) throw new HttpError(400, 'Refund amount must be > 0');
  if (!params.reason?.trim()) throw new HttpError(400, 'Refund reason is required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await getOrCreateAccount(client, {
      schoolId: params.schoolId,
      studentId: params.studentId,
      academicYear: params.academicYear,
    });

    const paid = Number(account.total_paid);
    const refunded = Number(account.total_refunded);
    const refundable = moneySub(paid, refunded);
    if (moneyGt(amount, refundable)) {
      throw new HttpError(400, 'Refund exceeds refundable amount');
    }

    if (params.paymentId) {
      const payment = await client.query(
        `SELECT * FROM payments
         WHERE id = $1 AND account_id = $2 AND school_id = $3 AND status = 'completed'
         FOR UPDATE`,
        [params.paymentId, account.id, params.schoolId],
      );
      if (!payment.rowCount) throw new HttpError(404, 'Payment not found');
      const already = await client.query(
        `SELECT COALESCE(SUM(amount),0)::float8 AS s FROM fee_refunds WHERE payment_id = $1`,
        [params.paymentId],
      );
      const leftOnPayment = moneySub(payment.rows[0].amount, already.rows[0].s);
      if (moneyGt(amount, leftOnPayment)) {
        throw new HttpError(400, 'Refund exceeds this payment remaining refundable amount');
      }
      if (moneyGte(amount, payment.rows[0].amount)) {
        await client.query(`UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1`, [
          params.paymentId,
        ]);
      }
    }

    const refund = await client.query(
      `INSERT INTO fee_refunds
         (school_id, account_id, student_id, payment_id, amount, reason, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        params.schoolId,
        account.id,
        params.studentId,
        params.paymentId ?? null,
        amount,
        params.reason,
        params.actorId,
      ],
    );

    await refreshAccountTotals(client, account.id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'fee_refund',
      entityId: refund.rows[0].id,
      action: 'create',
      studentId: params.studentId,
      newValues: refund.rows[0],
      reason: params.reason,
      changedBy: params.actorId,
    });

    await client.query('COMMIT');
    return refund.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelInstallment(params: {
  schoolId: number;
  installmentId: number;
  reason: string;
  actorId: number;
}) {
  if (!params.reason?.trim()) throw new HttpError(400, 'Cancel reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query(
      `SELECT * FROM installments
       WHERE id = $1 AND school_id = $2 AND cancelled_at IS NULL
       FOR UPDATE`,
      [params.installmentId, params.schoolId],
    );
    if (!row.rowCount) throw new HttpError(404, 'Installment not found');
    const inst = row.rows[0];
    if (moneyGt(inst.paid_amount, 0)) {
      throw new HttpError(400, 'Cannot cancel an installment that already has payments');
    }
    await client.query(
      `UPDATE installments
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [params.installmentId],
    );
    await refreshAccountTotals(client, inst.account_id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'installment',
      entityId: params.installmentId,
      action: 'cancel',
      studentId: inst.student_id,
      oldValues: inst,
      reason: params.reason,
      changedBy: params.actorId,
    });
    await client.query('COMMIT');
    return { id: params.installmentId, status: 'cancelled' };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateInstallmentDueDate(params: {
  schoolId: number;
  installmentId: number;
  dueDate: string;
  actorId: number;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query(
      `SELECT * FROM installments
       WHERE id = $1 AND school_id = $2 AND cancelled_at IS NULL
       FOR UPDATE`,
      [params.installmentId, params.schoolId],
    );
    if (!row.rowCount) throw new HttpError(404, 'Installment not found');
    const inst = row.rows[0];
    if (inst.status === 'paid') {
      throw new HttpError(400, 'Cannot change due date of a fully paid installment');
    }
    const status = deriveInstallmentStatus(
      Number(inst.amount),
      Number(inst.paid_amount),
      params.dueDate,
    );
    const updated = await client.query(
      `UPDATE installments
       SET due_date = $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [params.dueDate, status, params.installmentId],
    );
    await refreshAccountTotals(client, inst.account_id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'installment',
      entityId: params.installmentId,
      action: 'update_due_date',
      studentId: inst.student_id,
      oldValues: { due_date: inst.due_date },
      newValues: { due_date: params.dueDate, status },
      changedBy: params.actorId,
    });
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Reverse a completed payment: undo allocations and mark payment reversed (never delete). */
export async function reversePayment(params: {
  schoolId: number;
  paymentId: number;
  reason: string;
  actorId: number;
}) {
  if (!params.reason?.trim()) throw new HttpError(400, 'Reversal reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await client.query(
      `SELECT * FROM payments
       WHERE id = $1 AND school_id = $2
       FOR UPDATE`,
      [params.paymentId, params.schoolId],
    );
    if (!payment.rowCount) throw new HttpError(404, 'Payment not found');
    const p = payment.rows[0];
    if (p.status !== 'completed') {
      throw new HttpError(400, 'Only completed payments can be reversed');
    }

    const allocations = await client.query(
      `SELECT * FROM payment_allocations WHERE payment_id = $1 FOR UPDATE`,
      [params.paymentId],
    );

    for (const alloc of allocations.rows) {
      if (alloc.installment_id) {
        const inst = await client.query(
          `SELECT * FROM installments WHERE id = $1 FOR UPDATE`,
          [alloc.installment_id],
        );
        if (inst.rowCount) {
          const newPaid = moneySub(inst.rows[0].paid_amount, alloc.amount);
          const paid = moneyLt(newPaid, 0) ? 0 : newPaid;
          const status = deriveInstallmentStatus(
            Number(inst.rows[0].amount),
            paid,
            String(inst.rows[0].due_date).slice(0, 10),
          );
          await client.query(
            `UPDATE installments SET paid_amount = $1, status = $2, updated_at = NOW() WHERE id = $3`,
            [paid, status, alloc.installment_id],
          );
        }
      }
      if (alloc.fee_item_id) {
        const item = await client.query(
          `SELECT * FROM student_fee_items WHERE id = $1 FOR UPDATE`,
          [alloc.fee_item_id],
        );
        if (item.rowCount) {
          const newPaid = moneySub(item.rows[0].paid_amount, alloc.amount);
          await client.query(
            `UPDATE student_fee_items SET paid_amount = $1, updated_at = NOW() WHERE id = $2`,
            [moneyLt(newPaid, 0) ? 0 : newPaid, alloc.fee_item_id],
          );
        }
      }
    }

    await client.query(
      `UPDATE payments SET status = 'reversed', notes = COALESCE(notes,'') || $1, updated_at = NOW()
       WHERE id = $2`,
      [`\n[REVERSED] ${params.reason}`, params.paymentId],
    );

    await refreshAccountTotals(client, p.account_id);
    await audit(client, {
      schoolId: params.schoolId,
      entityType: 'payment',
      entityId: params.paymentId,
      action: 'reverse',
      studentId: p.student_id,
      oldValues: p,
      reason: params.reason,
      changedBy: params.actorId,
    });

    await client.query('COMMIT');
    const fresh = await pool.query(`SELECT * FROM payments WHERE id = $1`, [params.paymentId]);
    return fresh.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function assertParentOwnsStudent(parentId: number, studentId: number, schoolId: number) {
  const result = await pool.query(
    `SELECT 1
     FROM parent_students ps
     JOIN users s ON s.id = ps.student_id
     WHERE ps.parent_id = $1 AND ps.student_id = $2
       AND s.school_id = $3 AND s.role = 'student' AND s.deleted_at IS NULL`,
    [parentId, studentId, schoolId],
  );
  if (!result.rowCount) throw new HttpError(403, 'Student is not linked to this parent');
}

export async function getStudentAccount(schoolId: number, studentId: number, academicYear: string) {
  await assertSchoolStudent(schoolId, studentId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await getOrCreateAccount(client, { schoolId, studentId, academicYear });
    await refreshAccountTotals(client, account.id);
    await client.query('COMMIT');

    const fresh = await pool.query(`SELECT * FROM student_fee_accounts WHERE id = $1`, [account.id]);
    const items = await pool.query(
      `SELECT * FROM student_fee_items WHERE account_id = $1 AND cancelled_at IS NULL ORDER BY id`,
      [account.id],
    );
    const installments = await pool.query(
      `SELECT i.*, p.title AS plan_title
       FROM installments i
       JOIN installment_plans p ON p.id = i.plan_id
       WHERE i.account_id = $1 AND i.cancelled_at IS NULL
       ORDER BY i.due_date, i.sequence_no`,
      [account.id],
    );
    const payments = await pool.query(
      `SELECT * FROM payments WHERE account_id = $1 ORDER BY paid_at DESC LIMIT 100`,
      [account.id],
    );
    const discounts = await pool.query(
      `SELECT * FROM fee_discounts WHERE account_id = $1 AND cancelled_at IS NULL ORDER BY id DESC`,
      [account.id],
    );

    return {
      account: fresh.rows[0],
      items: items.rows,
      installments: installments.rows,
      payments: payments.rows,
      discounts: discounts.rows,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
