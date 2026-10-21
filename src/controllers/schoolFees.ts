import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  applyDiscount,
  applyFeeStructureToTargets,
  assertParentOwnsStudent,
  assignFeeToStudent,
  cancelInstallment,
  createInstallmentPlan,
  getStudentAccount,
  recordPayment,
  recordRefund,
  reversePayment,
  updateInstallmentDueDate,
} from '../services/fees';
import {
  ApplyDiscountSchema,
  AssignDirectFeeSchema,
  AssignFeeSchema,
  CancelInstallmentSchema,
  CreateFeeCategorySchema,
  CreateFeeStructureSchema,
  CreateInstallmentPlanSchema,
  RecordPaymentSchema,
  RecordRefundSchema,
  ReversePaymentSchema,
  UpdateFeeStructureSchema,
  UpdateInstallmentDueDateSchema,
} from './schoolFees.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'Account is not linked to a school');
  }
  return user.school_id;
}

const financeRoles = ['school_admin'] as const;
const readStaffRoles = ['school_admin', 'teacher'] as const;

function parsePaging(query: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const skip = Math.max(Number(query.skip) || 0, 0);
  return { limit, skip };
}

// ─── Categories ─────────────────────────────────────────────

router.get(
  '/categories',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await pool.query(
      `SELECT id, name, description, is_active, created_at
       FROM fee_categories
       WHERE school_id = $1 AND deleted_at IS NULL
       ORDER BY name`,
      [schoolId],
    );
    res.json({ categories: result.rows });
  }),
);

router.post(
  '/categories',
  authMiddleware([...financeRoles]),
  validate(CreateFeeCategorySchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await pool.query(
      `INSERT INTO fee_categories (school_id, name, description)
       VALUES ($1,$2,$3)
       RETURNING id, name, description, is_active, created_at`,
      [schoolId, req.body.name, req.body.description ?? null],
    );
    res.status(201).json({ message: 'Fee category created', category: result.rows[0] });
  }),
);

// ─── Fee structures ─────────────────────────────────────────

router.get(
  '/structures',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const academicYear = String(req.query.academic_year || '').trim();
    const values: unknown[] = [schoolId];
    const conditions = ['fs.school_id = $1', 'fs.deleted_at IS NULL'];
    let i = 2;
    if (academicYear) {
      conditions.push(`fs.academic_year = $${i++}`);
      values.push(academicYear);
    }
    if (req.query.is_active === 'true' || req.query.is_active === 'false') {
      conditions.push(`fs.is_active = $${i++}`);
      values.push(req.query.is_active === 'true');
    }
    const where = conditions.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM fee_structures fs WHERE ${where}`,
      values,
    );
    values.push(limit, skip);
    const result = await pool.query(
      `SELECT fs.*, fc.name AS category_name, g.name AS grade_name
       FROM fee_structures fs
       LEFT JOIN fee_categories fc ON fc.id = fs.category_id
       LEFT JOIN grades g ON g.id = fs.grade_id
       WHERE ${where}
       ORDER BY fs.academic_year DESC, fs.id DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );
    res.json({
      structures: result.rows,
      total: count.rows[0].total,
      limit,
      skip,
    });
  }),
);

router.post(
  '/structures',
  authMiddleware([...financeRoles]),
  validate(CreateFeeStructureSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const b = req.body;

    if (b.category_id) {
      const cat = await pool.query(
        `SELECT id FROM fee_categories WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [b.category_id, schoolId],
      );
      if (!cat.rowCount) throw new HttpError(404, 'Fee category not found');
    }
    if (b.grade_id) {
      const grade = await pool.query(
        `SELECT id FROM grades WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [b.grade_id, schoolId],
      );
      if (!grade.rowCount) throw new HttpError(404, 'Grade not found in your school');
    }
    if (b.assignment_scope === 'grade' && !b.grade_id) {
      throw new HttpError(400, 'grade_id is required when assignment_scope is grade');
    }

    const result = await pool.query(
      `INSERT INTO fee_structures
         (school_id, category_id, name, description, amount, academic_year, grade_id,
          is_mandatory, due_date, assignment_scope, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        schoolId,
        b.category_id ?? null,
        b.name,
        b.description ?? null,
        b.amount,
        b.academic_year,
        b.grade_id ?? null,
        b.is_mandatory ?? true,
        b.due_date ?? null,
        b.assignment_scope,
        req.user!.id,
      ],
    );
    res.status(201).json({ message: 'Fee structure created', structure: result.rows[0] });
  }),
);

router.patch(
  '/structures/:id',
  authMiddleware([...financeRoles]),
  validate(UpdateFeeStructureSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');

    const existing = await pool.query(
      `SELECT * FROM fee_structures WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Fee structure not found');

    const b = req.body;
    const result = await pool.query(
      `UPDATE fee_structures SET
         name = COALESCE($1, name),
         description = CASE WHEN $2::boolean THEN $3 ELSE description END,
         amount = COALESCE($4, amount),
         due_date = CASE WHEN $5::boolean THEN $6 ELSE due_date END,
         is_mandatory = COALESCE($7, is_mandatory),
         is_active = COALESCE($8, is_active),
         grade_id = CASE WHEN $9::boolean THEN $10 ELSE grade_id END,
         assignment_scope = COALESCE($11, assignment_scope),
         updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        b.name ?? null,
        Object.prototype.hasOwnProperty.call(b, 'description'),
        b.description ?? null,
        b.amount ?? null,
        Object.prototype.hasOwnProperty.call(b, 'due_date'),
        b.due_date ?? null,
        b.is_mandatory ?? null,
        b.is_active ?? null,
        Object.prototype.hasOwnProperty.call(b, 'grade_id'),
        b.grade_id ?? null,
        b.assignment_scope ?? null,
        id,
      ],
    );
    res.json({ message: 'Fee structure updated', structure: result.rows[0] });
  }),
);

router.delete(
  '/structures/:id',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    const result = await pool.query(
      `UPDATE fee_structures SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Fee structure not found');
    res.json({ message: 'Fee structure deactivated', id });
  }),
);

// ─── Assign fees ────────────────────────────────────────────

router.post(
  '/assign',
  authMiddleware([...financeRoles]),
  validate(AssignFeeSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await applyFeeStructureToTargets({
      schoolId,
      feeStructureId: req.body.fee_structure_id,
      studentIds: req.body.student_ids,
      actorId: req.user!.id,
    });
    res.status(201).json({
      message: `Assigned fee to ${result.assigned_count} student(s)`,
      ...result,
    });
  }),
);

router.post(
  '/assign-direct',
  authMiddleware([...financeRoles]),
  validate(AssignDirectFeeSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const b = req.body;
    const item = await assignFeeToStudent({
      schoolId,
      studentId: b.student_id,
      academicYear: b.academic_year,
      feeStructureId: b.fee_structure_id,
      name: b.name,
      description: b.description,
      amount: b.amount,
      dueDate: b.due_date,
      isMandatory: b.is_mandatory,
      actorId: req.user!.id,
    });
    res.status(201).json({ message: 'Fee assigned to student', item });
  }),
);

// ─── Installments ───────────────────────────────────────────

router.post(
  '/installment-plans',
  authMiddleware([...financeRoles]),
  validate(CreateInstallmentPlanSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const b = req.body;
    const result = await createInstallmentPlan({
      schoolId,
      studentId: b.student_id,
      academicYear: b.academic_year,
      title: b.title,
      amounts: b.amounts,
      count: b.count,
      totalAmount: b.total_amount,
      firstDueDate: b.first_due_date,
      intervalDays: b.interval_days,
      dueDates: b.due_dates,
      actorId: req.user!.id,
    });
    res.status(201).json({ message: 'Installment plan created', ...result });
  }),
);

router.patch(
  '/installments/:id/due-date',
  authMiddleware([...financeRoles]),
  validate(UpdateInstallmentDueDateSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const installment = await updateInstallmentDueDate({
      schoolId,
      installmentId: Number(req.params.id),
      dueDate: req.body.due_date,
      actorId: req.user!.id,
    });
    res.json({ message: 'Installment due date updated', installment });
  }),
);

router.post(
  '/installments/:id/cancel',
  authMiddleware([...financeRoles]),
  validate(CancelInstallmentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await cancelInstallment({
      schoolId,
      installmentId: Number(req.params.id),
      reason: req.body.reason,
      actorId: req.user!.id,
    });
    res.json({ message: 'Installment cancelled', ...result });
  }),
);

// ─── Payments ───────────────────────────────────────────────

router.post(
  '/payments',
  authMiddleware([...financeRoles]),
  validate(RecordPaymentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const b = req.body;
    const result = await recordPayment({
      schoolId,
      studentId: b.student_id,
      academicYear: b.academic_year,
      amount: b.amount,
      method: b.method,
      reference: b.reference,
      notes: b.notes,
      installmentIds: b.installment_ids,
      idempotencyKey: b.idempotency_key,
      actorId: req.user!.id,
    });
    const status = result.idempotent_replay ? 200 : 201;
    res.status(status).json({
      message: result.idempotent_replay ? 'Payment already recorded (idempotent)' : 'Payment recorded',
      ...result,
    });
  }),
);

router.get(
  '/payments',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const values: unknown[] = [schoolId];
    const conditions = ['p.school_id = $1'];
    let i = 2;

    if (req.query.student_id) {
      conditions.push(`p.student_id = $${i++}`);
      values.push(Number(req.query.student_id));
    }
    if (req.query.method) {
      conditions.push(`p.method = $${i++}`);
      values.push(String(req.query.method));
    }
    if (req.query.status) {
      conditions.push(`p.status = $${i++}`);
      values.push(String(req.query.status));
    }
    if (req.query.from) {
      conditions.push(`p.paid_at >= $${i++}::timestamptz`);
      values.push(String(req.query.from));
    }
    if (req.query.to) {
      conditions.push(`p.paid_at < ($${i++}::date + INTERVAL '1 day')`);
      values.push(String(req.query.to));
    }
    if (req.query.recorded_by) {
      conditions.push(`p.recorded_by = $${i++}`);
      values.push(Number(req.query.recorded_by));
    }

    const where = conditions.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payments p WHERE ${where}`,
      values,
    );
    values.push(limit, skip);
    const result = await pool.query(
      `SELECT p.*, u.name AS student_name, r.name AS recorded_by_name
       FROM payments p
       JOIN users u ON u.id = p.student_id
       LEFT JOIN users r ON r.id = p.recorded_by
       WHERE ${where}
       ORDER BY p.paid_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );
    res.json({ payments: result.rows, total: count.rows[0].total, limit, skip });
  }),
);

router.get(
  '/payments/:id',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    const payment = await pool.query(
      `SELECT p.*, u.name AS student_name, r.name AS recorded_by_name
       FROM payments p
       JOIN users u ON u.id = p.student_id
       LEFT JOIN users r ON r.id = p.recorded_by
       WHERE p.id = $1 AND p.school_id = $2`,
      [id, schoolId],
    );
    if (!payment.rowCount) throw new HttpError(404, 'Payment not found');
    const allocations = await pool.query(
      `SELECT * FROM payment_allocations WHERE payment_id = $1 ORDER BY id`,
      [id],
    );
    res.json({ payment: payment.rows[0], allocations: allocations.rows });
  }),
);

router.post(
  '/payments/:id/reverse',
  authMiddleware([...financeRoles]),
  validate(ReversePaymentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const payment = await reversePayment({
      schoolId,
      paymentId: Number(req.params.id),
      reason: req.body.reason,
      actorId: req.user!.id,
    });
    res.json({ message: 'Payment reversed', payment });
  }),
);

// ─── Discounts & refunds ────────────────────────────────────

router.post(
  '/discounts',
  authMiddleware([...financeRoles]),
  validate(ApplyDiscountSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const b = req.body;
    const discount = await applyDiscount({
      schoolId,
      studentId: b.student_id,
      academicYear: b.academic_year,
      feeItemId: b.fee_item_id,
      name: b.name,
      discountType: b.discount_type,
      value: b.value,
      reason: b.reason,
      actorId: req.user!.id,
    });
    res.status(201).json({ message: 'Discount applied', discount });
  }),
);

router.post(
  '/refunds',
  authMiddleware([...financeRoles]),
  validate(RecordRefundSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const b = req.body;
    const refund = await recordRefund({
      schoolId,
      studentId: b.student_id,
      academicYear: b.academic_year,
      paymentId: b.payment_id,
      amount: b.amount,
      reason: b.reason,
      actorId: req.user!.id,
    });
    res.status(201).json({ message: 'Refund recorded', refund });
  }),
);

// ─── Student account ────────────────────────────────────────

router.get(
  '/accounts/:studentId',
  authMiddleware([...readStaffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const studentId = Number(req.params.studentId);
    const academicYear = String(req.query.academic_year || '').trim();
    if (!academicYear) throw new HttpError(400, 'academic_year query param is required');
    const data = await getStudentAccount(schoolId, studentId, academicYear);
    res.json(data);
  }),
);

/** Parent/student read-only statement */
router.get(
  '/my-account',
  authMiddleware(['parent', 'student']),
  asyncWrapper(async (req, res) => {
    const academicYear = String(req.query.academic_year || '').trim();
    if (!academicYear) throw new HttpError(400, 'academic_year query param is required');

    let studentId: number;
    let schoolId: number;

    if (req.user!.role === 'student') {
      studentId = req.user!.id;
      schoolId = requireSchoolId(req.user);
    } else {
      studentId = Number(req.query.student_id);
      if (!Number.isInteger(studentId) || studentId < 1) {
        throw new HttpError(400, 'student_id query param is required for parents');
      }
      const schoolRow = await pool.query(
        `SELECT school_id FROM users WHERE id = $1 AND role = 'student' AND deleted_at IS NULL`,
        [studentId],
      );
      if (!schoolRow.rowCount || !schoolRow.rows[0].school_id) {
        throw new HttpError(404, 'Student not found');
      }
      schoolId = schoolRow.rows[0].school_id;
      await assertParentOwnsStudent(req.user!.id, studentId, schoolId);
    }

    const data = await getStudentAccount(schoolId, studentId, academicYear);
    res.json({
      account: data.account,
      items: data.items,
      installments: data.installments,
      payments: data.payments.map((p: Record<string, unknown>) => ({
        id: p.id,
        receipt_number: p.receipt_number,
        amount: p.amount,
        method: p.method,
        status: p.status,
        paid_at: p.paid_at,
      })),
      discounts: data.discounts,
    });
  }),
);

// ─── Reports ────────────────────────────────────────────────

router.get(
  '/reports/summary',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const academicYear = String(req.query.academic_year || '').trim() || null;
    const from = String(req.query.from || '').trim() || null;
    const to = String(req.query.to || '').trim() || null;

    const yearFilter = academicYear ? 'AND academic_year = $2' : '';
    const yearParams: unknown[] = academicYear ? [schoolId, academicYear] : [schoolId];

    const accounts = await pool.query(
      `SELECT
         COALESCE(SUM(total_fees),0)::float8 AS total_fees,
         COALESCE(SUM(total_discounts),0)::float8 AS total_discounts,
         COALESCE(SUM(total_paid),0)::float8 AS total_paid,
         COALESCE(SUM(total_refunded),0)::float8 AS total_refunded,
         COALESCE(SUM(balance_due),0)::float8 AS balance_due,
         COALESCE(SUM(overdue_amount),0)::float8 AS overdue_amount,
         COUNT(*)::int AS accounts_count
       FROM student_fee_accounts
       WHERE school_id = $1 ${yearFilter}`,
      yearParams,
    );

    const payParams: unknown[] = [schoolId];
    let pi = 2;
    const payConds = [`school_id = $1`, `status = 'completed'`];
    if (from) {
      payConds.push(`paid_at >= $${pi++}::timestamptz`);
      payParams.push(from);
    }
    if (to) {
      payConds.push(`paid_at < ($${pi++}::date + INTERVAL '1 day')`);
      payParams.push(to);
    }
    const collected = await pool.query(
      `SELECT COALESCE(SUM(amount),0)::float8 AS collected, COUNT(*)::int AS payments_count
       FROM payments WHERE ${payConds.join(' AND ')}`,
      payParams,
    );

    const overdue = await pool.query(
      `SELECT COUNT(*)::int AS overdue_installments,
              COALESCE(SUM(amount - paid_amount),0)::float8 AS overdue_amount
       FROM installments
       WHERE school_id = $1 AND cancelled_at IS NULL
         AND due_date < CURRENT_DATE AND paid_amount < amount`,
      [schoolId],
    );

    res.json({
      accounts: accounts.rows[0],
      collections: collected.rows[0],
      overdue: overdue.rows[0],
      filters: { academic_year: academicYear, from, to },
    });
  }),
);

router.get(
  '/reports/overdue',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const values: unknown[] = [schoolId];
    let i = 2;
    const conditions = [
      'i.school_id = $1',
      'i.cancelled_at IS NULL',
      'i.due_date < CURRENT_DATE',
      'i.paid_amount < i.amount',
    ];
    if (req.query.grade_id) {
      conditions.push(`sp.grade_id = $${i++}`);
      values.push(Number(req.query.grade_id));
    }
    if (req.query.classroom_id) {
      conditions.push(`sp.classroom_id = $${i++}`);
      values.push(Number(req.query.classroom_id));
    }
    if (req.query.academic_year) {
      conditions.push(`a.academic_year = $${i++}`);
      values.push(String(req.query.academic_year));
    }
    const where = conditions.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM installments i
       JOIN student_fee_accounts a ON a.id = i.account_id
       JOIN student_profiles sp ON sp.user_id = i.student_id
       WHERE ${where}`,
      values,
    );
    values.push(limit, skip);
    const rows = await pool.query(
      `SELECT i.id, i.student_id, u.name AS student_name, i.amount::float8 AS amount,
              i.paid_amount::float8 AS paid_amount,
              (i.amount - i.paid_amount)::float8 AS remaining,
              i.due_date::text AS due_date, i.status, a.academic_year,
              g.name AS grade_name, c.name AS classroom_name
       FROM installments i
       JOIN student_fee_accounts a ON a.id = i.account_id
       JOIN users u ON u.id = i.student_id
       JOIN student_profiles sp ON sp.user_id = i.student_id
       LEFT JOIN grades g ON g.id = sp.grade_id
       LEFT JOIN classrooms c ON c.id = sp.classroom_id
       WHERE ${where}
       ORDER BY i.due_date ASC, i.id ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );
    res.json({ overdue: rows.rows, total: count.rows[0].total, limit, skip });
  }),
);

router.get(
  '/reports/collections-by-grade',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const academicYear = String(req.query.academic_year || '').trim() || null;
    const params: unknown[] = [schoolId];
    let yearSql = '';
    if (academicYear) {
      yearSql = 'AND a.academic_year = $2';
      params.push(academicYear);
    }
    const result = await pool.query(
      `SELECT g.id AS grade_id, g.name AS grade_name,
              COALESCE(SUM(p.amount),0)::float8 AS collected,
              COUNT(p.id)::int AS payments_count
       FROM payments p
       JOIN student_fee_accounts a ON a.id = p.account_id
       JOIN student_profiles sp ON sp.user_id = p.student_id
       LEFT JOIN grades g ON g.id = sp.grade_id
       WHERE p.school_id = $1 AND p.status = 'completed' ${yearSql}
       GROUP BY g.id, g.name
       ORDER BY g.name NULLS LAST`,
      params,
    );
    res.json({ by_grade: result.rows });
  }),
);

router.get(
  '/reports/collections-by-method',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await pool.query(
      `SELECT method, COALESCE(SUM(amount),0)::float8 AS collected, COUNT(*)::int AS payments_count
       FROM payments
       WHERE school_id = $1 AND status = 'completed'
       GROUP BY method
       ORDER BY collected DESC`,
      [schoolId],
    );
    res.json({ by_method: result.rows });
  }),
);

router.get(
  '/reports/collections-by-collector',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await pool.query(
      `SELECT p.recorded_by, u.name AS collector_name,
              COALESCE(SUM(p.amount),0)::float8 AS collected,
              COUNT(*)::int AS payments_count
       FROM payments p
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.school_id = $1 AND p.status = 'completed'
       GROUP BY p.recorded_by, u.name
       ORDER BY collected DESC`,
      [schoolId],
    );
    res.json({ by_collector: result.rows });
  }),
);

router.get(
  '/reports/upcoming-installments',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const from = String(req.query.from || new Date().toISOString().slice(0, 10));
    const to = String(req.query.to || '').trim();
    const values: unknown[] = [schoolId, from];
    let i = 3;
    const conditions = [
      'i.school_id = $1',
      'i.cancelled_at IS NULL',
      'i.paid_amount < i.amount',
      'i.due_date >= $2::date',
    ];
    if (to) {
      conditions.push(`i.due_date <= $${i++}::date`);
      values.push(to);
    }
    values.push(limit, skip);
    const rows = await pool.query(
      `SELECT i.id, i.student_id, u.name AS student_name, i.amount::float8 AS amount,
              i.paid_amount::float8 AS paid_amount,
              (i.amount - i.paid_amount)::float8 AS remaining,
              i.due_date::text AS due_date, i.status
       FROM installments i
       JOIN users u ON u.id = i.student_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.due_date ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );
    res.json({ upcoming: rows.rows, limit, skip });
  }),
);

router.get(
  '/reports/discounts',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM fee_discounts WHERE school_id = $1 AND cancelled_at IS NULL`,
      [schoolId],
    );
    const rows = await pool.query(
      `SELECT d.*, u.name AS student_name, c.name AS created_by_name
       FROM fee_discounts d
       JOIN users u ON u.id = d.student_id
       LEFT JOIN users c ON c.id = d.created_by
       WHERE d.school_id = $1 AND d.cancelled_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT $2 OFFSET $3`,
      [schoolId, limit, skip],
    );
    res.json({ discounts: rows.rows, total: count.rows[0].total, limit, skip });
  }),
);

router.get(
  '/reports/refunds',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM fee_refunds WHERE school_id = $1`,
      [schoolId],
    );
    const rows = await pool.query(
      `SELECT r.*, u.name AS student_name, c.name AS recorded_by_name
       FROM fee_refunds r
       JOIN users u ON u.id = r.student_id
       LEFT JOIN users c ON c.id = r.recorded_by
       WHERE r.school_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [schoolId, limit, skip],
    );
    res.json({ refunds: rows.rows, total: count.rows[0].total, limit, skip });
  }),
);

router.get(
  '/audit-logs',
  authMiddleware([...financeRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { limit, skip } = parsePaging(req.query as Record<string, unknown>);
    const values: unknown[] = [schoolId];
    const conditions = ['a.school_id = $1'];
    let i = 2;
    if (req.query.student_id) {
      conditions.push(`a.student_id = $${i++}`);
      values.push(Number(req.query.student_id));
    }
    if (req.query.entity_type) {
      conditions.push(`a.entity_type = $${i++}`);
      values.push(String(req.query.entity_type));
    }
    const where = conditions.join(' AND ');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM financial_audit_logs a WHERE ${where}`,
      values,
    );
    values.push(limit, skip);
    const rows = await pool.query(
      `SELECT a.*, u.name AS changed_by_name
       FROM financial_audit_logs a
       LEFT JOIN users u ON u.id = a.changed_by
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );
    res.json({ logs: rows.rows, total: count.rows[0].total, limit, skip });
  }),
);
