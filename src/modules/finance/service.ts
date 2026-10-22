import pool from '../../db/pool';
import { HttpError } from '../../utils';
import type { z } from 'zod';
import type {
  AssignStructureSchema,
  CreateCategorySchema,
  CreateStructureSchema,
  RecordPaymentSchema,
} from './schemas';

function addMonths(isoDate: string, months: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function refreshAccountTotals(client: typeof pool | any, accountId: string) {
  await client.query(
    `UPDATE erp_fee_accounts a SET
       total_fees = COALESCE((SELECT SUM(amount) FROM erp_installments i WHERE i.account_id = a.id AND i.status <> 'cancelled'), 0),
       total_paid = COALESCE((SELECT SUM(amount) FROM erp_payments p WHERE p.account_id = a.id), 0),
       balance_due = GREATEST(
         COALESCE((SELECT SUM(amount - paid_amount) FROM erp_installments i WHERE i.account_id = a.id AND i.status <> 'cancelled'), 0),
         0
       ),
       overdue_amount = COALESCE((
         SELECT SUM(amount - paid_amount) FROM erp_installments i
         WHERE i.account_id = a.id AND i.status IN ('pending','partial','overdue') AND i.due_date < CURRENT_DATE
       ), 0),
       updated_at = NOW()
     WHERE a.id = $1`,
    [accountId],
  );
}

export async function financeSummary(tenantId: string) {
  await pool.query(
    `UPDATE erp_installments SET status = 'overdue', updated_at = NOW()
     WHERE tenant_id = $1 AND status IN ('pending','partial') AND due_date < CURRENT_DATE AND paid_amount < amount`,
    [tenantId],
  );

  const result = await pool.query(
    `SELECT
       COALESCE(SUM(total_fees),0)::float AS total_fees,
       COALESCE(SUM(total_paid),0)::float AS total_collected,
       COALESCE(SUM(balance_due),0)::float AS balance_due,
       COALESCE(SUM(overdue_amount),0)::float AS overdue_amount,
       COUNT(*)::int AS accounts
     FROM erp_fee_accounts WHERE tenant_id = $1`,
    [tenantId],
  );

  const installments = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
       COUNT(*) FILTER (WHERE status IN ('pending','partial'))::int AS open,
       COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue
     FROM erp_installments WHERE tenant_id = $1`,
    [tenantId],
  );

  const recent = await pool.query(
    `SELECT p.*, s.full_name AS student_name
     FROM erp_payments p
     JOIN students s ON s.id = p.student_id
     WHERE p.tenant_id = $1
     ORDER BY p.paid_at DESC
     LIMIT 8`,
    [tenantId],
  );

  const row = result.rows[0];
  const collected = Number(row.total_collected) || 0;
  const fees = Number(row.total_fees) || 0;
  return {
    ...row,
    collection_rate: fees > 0 ? Math.round((collected / fees) * 100) : 0,
    installments: installments.rows[0],
    recent_payments: recent.rows,
  };
}

export async function listCategories(tenantId: string) {
  const result = await pool.query(
    `SELECT * FROM erp_fee_categories WHERE tenant_id = $1 AND is_active ORDER BY name`,
    [tenantId],
  );
  return result.rows;
}

export async function createCategory(
  tenantId: string,
  input: z.infer<typeof CreateCategorySchema>,
) {
  const result = await pool.query(
    `INSERT INTO erp_fee_categories (tenant_id, name, description)
     VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       description = COALESCE(EXCLUDED.description, erp_fee_categories.description),
       is_active = TRUE
     RETURNING *`,
    [tenantId, input.name, input.description ?? null],
  );
  return result.rows[0];
}

export async function listStructures(tenantId: string, userId?: string) {
  const result = await pool.query(
    `SELECT fs.*, fc.name AS category_name, g.name AS grade_name, ay.name AS academic_year_name
     FROM erp_fee_structures fs
     LEFT JOIN erp_fee_categories fc ON fc.id = fs.category_id
     LEFT JOIN grade_levels g ON g.id = fs.grade_level_id
     LEFT JOIN academic_years ay ON ay.id = fs.academic_year_id
     WHERE fs.tenant_id = $1 AND fs.is_active
     ORDER BY fs.created_at DESC`,
    [tenantId],
  );
  if (result.rowCount || !userId) return result.rows;
  await seedDefaultFees(tenantId, userId);
  const again = await pool.query(
    `SELECT fs.*, fc.name AS category_name, g.name AS grade_name, ay.name AS academic_year_name
     FROM erp_fee_structures fs
     LEFT JOIN erp_fee_categories fc ON fc.id = fs.category_id
     LEFT JOIN grade_levels g ON g.id = fs.grade_level_id
     LEFT JOIN academic_years ay ON ay.id = fs.academic_year_id
     WHERE fs.tenant_id = $1 AND fs.is_active
     ORDER BY fs.created_at DESC`,
    [tenantId],
  );
  return again.rows;
}

export async function createStructure(
  tenantId: string,
  userId: string,
  input: z.infer<typeof CreateStructureSchema>,
) {
  const result = await pool.query(
    `INSERT INTO erp_fee_structures (
       tenant_id, category_id, name, academic_year_id, grade_level_id,
       amount, currency, installment_count, is_mandatory, due_date, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      tenantId,
      input.category_id ?? null,
      input.name,
      input.academic_year_id ?? null,
      input.grade_level_id ?? null,
      input.amount,
      input.currency ?? 'EGP',
      input.installment_count ?? 3,
      input.is_mandatory ?? true,
      input.due_date ?? null,
      userId,
    ],
  );
  return result.rows[0];
}

export async function assignStructure(
  tenantId: string,
  structureId: string,
  input: z.infer<typeof AssignStructureSchema>,
) {
  const structure = await pool.query(
    `SELECT * FROM erp_fee_structures WHERE id = $1 AND tenant_id = $2 AND is_active`,
    [structureId, tenantId],
  );
  if (!structure.rowCount) throw new HttpError(404, 'Fee structure not found');
  const fs = structure.rows[0];

  let studentIds = input.student_ids ?? [];
  if (input.assign_all_in_grade) {
    if (!fs.grade_level_id) throw new HttpError(400, 'Structure has no grade_level_id');
    const students = await pool.query(
      `SELECT id FROM students
       WHERE tenant_id = $1 AND grade_level_id = $2 AND lifecycle_status = 'ACTIVE'`,
      [tenantId, fs.grade_level_id],
    );
    studentIds = students.rows.map((r) => r.id as string);
  }
  if (!studentIds.length) throw new HttpError(400, 'No students to assign');

  const firstDue =
    input.first_due_date ||
    fs.due_date ||
    new Date().toISOString().slice(0, 10);
  const count = Number(fs.installment_count) || 1;
  const base = Math.floor((Number(fs.amount) / count) * 100) / 100;
  const remainder = Math.round((Number(fs.amount) - base * count) * 100) / 100;

  const client = await pool.connect();
  const assigned: string[] = [];
  try {
    await client.query('BEGIN');
    for (const studentId of studentIds) {
      const student = await client.query(
        `SELECT id FROM students WHERE id = $1 AND tenant_id = $2`,
        [studentId, tenantId],
      );
      if (!student.rowCount) continue;

      const account = await client.query(
        `INSERT INTO erp_fee_accounts (tenant_id, student_id, academic_year_id, currency)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, student_id, academic_year_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [tenantId, studentId, fs.academic_year_id, fs.currency],
      );
      const accountId = account.rows[0].id as string;

      for (let i = 1; i <= count; i++) {
        const amount = i === count ? base + remainder : base;
        await client.query(
          `INSERT INTO erp_installments (
             tenant_id, account_id, student_id, fee_structure_id,
             label, sequence_no, amount, due_date, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
          [
            tenantId,
            accountId,
            studentId,
            structureId,
            `${fs.name} — قسط ${i}/${count}`,
            i,
            amount,
            addMonths(firstDue, i - 1),
          ],
        );
      }
      await refreshAccountTotals(client, accountId);
      assigned.push(studentId);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { assigned_count: assigned.length, student_ids: assigned };
}

export async function listAccounts(tenantId: string) {
  const result = await pool.query(
    `SELECT a.*, s.full_name AS student_name, s.student_code
     FROM erp_fee_accounts a
     JOIN students s ON s.id = a.student_id
     WHERE a.tenant_id = $1
     ORDER BY a.balance_due DESC, s.full_name`,
    [tenantId],
  );
  return result.rows;
}

export async function listInstallments(
  tenantId: string,
  opts?: { status?: string; studentId?: string },
) {
  await pool.query(
    `UPDATE erp_installments SET status = 'overdue', updated_at = NOW()
     WHERE tenant_id = $1 AND status IN ('pending','partial') AND due_date < CURRENT_DATE AND paid_amount < amount`,
    [tenantId],
  );

  const values: unknown[] = [tenantId];
  const conditions = ['i.tenant_id = $1'];
  let n = 2;
  if (opts?.status) {
    conditions.push(`i.status = $${n++}`);
    values.push(opts.status);
  }
  if (opts?.studentId) {
    conditions.push(`i.student_id = $${n++}`);
    values.push(opts.studentId);
  }

  const result = await pool.query(
    `SELECT i.*, s.full_name AS student_name, s.student_code
     FROM erp_installments i
     JOIN students s ON s.id = i.student_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.due_date ASC, i.sequence_no ASC
     LIMIT 200`,
    values,
  );
  return result.rows;
}

export async function recordPayment(
  tenantId: string,
  userId: string,
  input: z.infer<typeof RecordPaymentSchema>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let installment: { id: string; account_id: string; amount: number; paid_amount: number } | null =
      null;
    if (input.installment_id) {
      const row = await client.query(
        `SELECT * FROM erp_installments WHERE id = $1 AND tenant_id = $2 AND student_id = $3`,
        [input.installment_id, tenantId, input.student_id],
      );
      if (!row.rowCount) throw new HttpError(404, 'Installment not found');
      installment = row.rows[0];
    } else {
      const row = await client.query(
        `SELECT * FROM erp_installments
         WHERE tenant_id = $1 AND student_id = $2 AND status IN ('pending','partial','overdue')
         ORDER BY due_date ASC LIMIT 1`,
        [tenantId, input.student_id],
      );
      if (!row.rowCount) throw new HttpError(404, 'No open installment for student');
      installment = row.rows[0];
    }

    const accountId = installment!.account_id;
    const remaining =
      Number(installment!.amount) - Number(installment!.paid_amount);
    if (input.amount > remaining + 0.001) {
      throw new HttpError(400, `Payment exceeds remaining (${remaining})`);
    }

    const payment = await client.query(
      `INSERT INTO erp_payments (
         tenant_id, account_id, installment_id, student_id,
         amount, method, reference, notes, received_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        tenantId,
        accountId,
        installment!.id,
        input.student_id,
        input.amount,
        input.method ?? 'cash',
        input.reference ?? null,
        input.notes ?? null,
        userId,
      ],
    );

    const newPaid = Number(installment!.paid_amount) + input.amount;
    const status =
      newPaid >= Number(installment!.amount) - 0.001
        ? 'paid'
        : newPaid > 0
          ? 'partial'
          : 'pending';

    await client.query(
      `UPDATE erp_installments SET paid_amount = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [installment!.id, newPaid, status],
    );
    await refreshAccountTotals(client, accountId);
    await client.query('COMMIT');
    return payment.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Bootstrap default tuition product for a tenant. */
export async function seedDefaultFees(tenantId: string, userId: string) {
  const cat = await createCategory(tenantId, {
    name: 'مصروفات دراسية',
    description: 'الرسوم الأساسية للعام الدراسي',
  });
  const year = await pool.query(
    `SELECT id FROM academic_years WHERE tenant_id = $1 ORDER BY is_current DESC LIMIT 1`,
    [tenantId],
  );
  const grade = await pool.query(
    `SELECT id FROM grade_levels WHERE tenant_id = $1 ORDER BY sequence_order LIMIT 1`,
    [tenantId],
  );
  const structure = await createStructure(tenantId, userId, {
    category_id: cat.id,
    name: 'مصروفات العام الدراسي',
    academic_year_id: year.rows[0]?.id,
    grade_level_id: grade.rows[0]?.id,
    amount: 15000,
    currency: 'EGP',
    installment_count: 3,
    is_mandatory: true,
  });
  return { category: cat, structure };
}
