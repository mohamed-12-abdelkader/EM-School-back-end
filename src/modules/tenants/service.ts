import pool from '../../db/pool';
import { HttpError } from '../../utils';
import { createUserWithMembership } from '../auth/service';
import type { z } from 'zod';
import type {
  AssignMembershipSchema,
  CreateAcademicYearSchema,
  CreateBranchSchema,
  CreateGradeLevelSchema,
  CreateSectionSchema,
  CreateStreamSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
} from './schemas';

export async function createTenant(input: z.infer<typeof CreateTenantSchema>) {
  const result = await pool.query(
    `INSERT INTO tenants (name, slug, subscription_plan, quota_max_students, enabled_modules)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      input.name,
      input.slug,
      input.subscription_plan,
      input.quota_max_students,
      JSON.stringify(input.enabled_modules),
    ],
  );
  return result.rows[0];
}

export async function updateTenant(tenantId: string, input: z.infer<typeof UpdateTenantSchema>) {
  const result = await pool.query(
    `UPDATE tenants SET
      name = COALESCE($2, name),
      slug = COALESCE($3, slug),
      subscription_plan = COALESCE($4, subscription_plan),
      quota_max_students = COALESCE($5, quota_max_students),
      enabled_modules = COALESCE($6::jsonb, enabled_modules),
      is_active = COALESCE($7, is_active),
      settings = COALESCE($8::jsonb, settings)
     WHERE id = $1
     RETURNING *`,
    [
      tenantId,
      input.name ?? null,
      input.slug ?? null,
      input.subscription_plan ?? null,
      input.quota_max_students ?? null,
      input.enabled_modules ? JSON.stringify(input.enabled_modules) : null,
      input.is_active ?? null,
      input.settings ? JSON.stringify(input.settings) : null,
    ],
  );
  if (!result.rowCount) throw new HttpError(404, 'Tenant not found');
  return result.rows[0];
}

export async function listTenants() {
  const result = await pool.query(`SELECT * FROM tenants ORDER BY created_at DESC`);
  return result.rows;
}

export async function getTenant(tenantId: string) {
  const result = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
  if (!result.rowCount) throw new HttpError(404, 'Tenant not found');
  return result.rows[0];
}

export async function getTenantBySlug(slug: string) {
  const result = await pool.query(`SELECT * FROM tenants WHERE slug = $1 AND is_active`, [slug]);
  if (!result.rowCount) throw new HttpError(404, 'Tenant not found');
  return result.rows[0];
}

export async function createBranch(tenantId: string, input: z.infer<typeof CreateBranchSchema>) {
  const result = await pool.query(
    `INSERT INTO branches (tenant_id, name, code, address, timezone)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, input.name, input.code, input.address ?? null, input.timezone],
  );
  return result.rows[0];
}

export async function listBranches(tenantId: string) {
  const result = await pool.query(`SELECT * FROM branches WHERE tenant_id = $1 ORDER BY name`, [
    tenantId,
  ]);
  return result.rows;
}

export async function createAcademicYear(
  tenantId: string,
  input: z.infer<typeof CreateAcademicYearSchema>,
) {
  if (input.is_current) {
    await pool.query(`UPDATE academic_years SET is_current = FALSE WHERE tenant_id = $1`, [
      tenantId,
    ]);
  }
  const result = await pool.query(
    `INSERT INTO academic_years
      (tenant_id, branch_id, name, starts_on, ends_on, age_cutoff_month, age_cutoff_day, is_current)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      tenantId,
      input.branch_id ?? null,
      input.name,
      input.starts_on,
      input.ends_on,
      input.age_cutoff_month,
      input.age_cutoff_day,
      input.is_current,
    ],
  );
  return result.rows[0];
}

export async function listAcademicYears(tenantId: string) {
  const result = await pool.query(
    `SELECT * FROM academic_years WHERE tenant_id = $1 ORDER BY starts_on DESC`,
    [tenantId],
  );
  return result.rows;
}

export async function createStream(tenantId: string, input: z.infer<typeof CreateStreamSchema>) {
  const result = await pool.query(
    `INSERT INTO academic_streams (tenant_id, branch_id, name, grading_type)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenantId, input.branch_id, input.name, input.grading_type],
  );
  return result.rows[0];
}

export async function listStreams(tenantId: string, branchId?: string | null) {
  const result = branchId
    ? await pool.query(
        `SELECT * FROM academic_streams WHERE tenant_id = $1 AND branch_id = $2 ORDER BY name`,
        [tenantId, branchId],
      )
    : await pool.query(`SELECT * FROM academic_streams WHERE tenant_id = $1 ORDER BY name`, [
        tenantId,
      ]);
  return result.rows;
}

export async function createGradeLevel(
  tenantId: string,
  input: z.infer<typeof CreateGradeLevelSchema>,
) {
  const result = await pool.query(
    `INSERT INTO grade_levels
      (tenant_id, branch_id, stream_id, stage, name, sequence_order, attendance_mode, min_age_years, max_age_years)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.stream_id,
      input.stage,
      input.name,
      input.sequence_order,
      input.attendance_mode,
      input.min_age_years ?? null,
      input.max_age_years ?? null,
    ],
  );
  return result.rows[0];
}

export async function listGradeLevels(tenantId: string, branchId?: string | null) {
  const result = branchId
    ? await pool.query(
        `SELECT * FROM grade_levels WHERE tenant_id = $1 AND branch_id = $2 ORDER BY sequence_order`,
        [tenantId, branchId],
      )
    : await pool.query(
        `SELECT * FROM grade_levels WHERE tenant_id = $1 ORDER BY sequence_order`,
        [tenantId],
      );
  return result.rows;
}

export async function createSection(tenantId: string, input: z.infer<typeof CreateSectionSchema>) {
  const result = await pool.query(
    `INSERT INTO sections (tenant_id, branch_id, grade_level_id, academic_year_id, name, capacity)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.grade_level_id,
      input.academic_year_id,
      input.name,
      input.capacity,
    ],
  );
  return result.rows[0];
}

export async function assignMembership(
  tenantId: string,
  input: z.infer<typeof AssignMembershipSchema>,
) {
  const userId = await createUserWithMembership({
    email: input.email,
    phone: input.phone,
    password: input.password,
    full_name: input.full_name,
    tenantId,
    branchId: input.branch_id,
    role: input.role,
  });
  return { userId, ...input, password: undefined };
}
