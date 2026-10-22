import pool from '../../db/pool';
import { HttpError } from '../../utils';
import type { z } from 'zod';
import type {
  CreateSubjectSchema,
  CreateTimetableSchema,
  ReplaceSlotsSchema,
  UpsertTimetableSettingsSchema,
} from './schemas';

export async function getSettings(tenantId: string, branchId?: string | null) {
  let result = await pool.query(`SELECT * FROM erp_timetable_settings WHERE tenant_id = $1`, [
    tenantId,
  ]);
  if (!result.rowCount) {
    result = await pool.query(
      `INSERT INTO erp_timetable_settings (tenant_id, branch_id)
       VALUES ($1, $2)
       RETURNING *`,
      [tenantId, branchId ?? null],
    );
  }
  return result.rows[0];
}

export async function updateSettings(
  tenantId: string,
  branchId: string | null | undefined,
  input: z.infer<typeof UpsertTimetableSettingsSchema>,
) {
  await getSettings(tenantId, branchId);
  const result = await pool.query(
    `UPDATE erp_timetable_settings SET
       working_days = COALESCE($2, working_days),
       periods_per_day = COALESCE($3, periods_per_day),
       period_minutes = COALESCE($4, period_minutes),
       day_start_time = COALESCE($5::time, day_start_time),
       branch_id = COALESCE($6, branch_id),
       updated_at = NOW()
     WHERE tenant_id = $1
     RETURNING *`,
    [
      tenantId,
      input.working_days ?? null,
      input.periods_per_day ?? null,
      input.period_minutes ?? null,
      input.day_start_time ?? null,
      branchId ?? null,
    ],
  );
  return result.rows[0];
}

export async function listSubjects(tenantId: string, branchId?: string | null) {
  const result = await pool.query(
    `SELECT * FROM erp_subjects WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name`,
    [tenantId],
  );
  if (result.rowCount) return result.rows;
  return seedDefaultSubjects(tenantId, branchId);
}

export async function createSubject(
  tenantId: string,
  input: z.infer<typeof CreateSubjectSchema>,
) {
  const result = await pool.query(
    `INSERT INTO erp_subjects (tenant_id, branch_id, name, code, color)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, name) DO UPDATE SET
       code = COALESCE(EXCLUDED.code, erp_subjects.code),
       color = COALESCE(EXCLUDED.color, erp_subjects.color),
       is_active = TRUE
     RETURNING *`,
    [tenantId, input.branch_id ?? null, input.name, input.code ?? null, input.color ?? '#4F46E5'],
  );
  return result.rows[0];
}

export async function listTimetables(tenantId: string, branchId?: string | null) {
  const result = await pool.query(
    `SELECT t.*, s.name AS section_name, g.name AS grade_name
     FROM erp_timetables t
     JOIN sections s ON s.id = t.section_id
     JOIN grade_levels g ON g.id = s.grade_level_id
     WHERE t.tenant_id = $1 AND ($2::uuid IS NULL OR t.branch_id = $2)
     ORDER BY t.updated_at DESC`,
    [tenantId, branchId ?? null],
  );
  return result.rows;
}

export async function createTimetable(
  tenantId: string,
  branchId: string,
  userId: string,
  input: z.infer<typeof CreateTimetableSchema>,
) {
  const section = await pool.query(
    `SELECT id, branch_id, academic_year_id FROM sections WHERE id = $1 AND tenant_id = $2`,
    [input.section_id, tenantId],
  );
  if (!section.rowCount) throw new HttpError(404, 'Section not found');

  const yearId = input.academic_year_id ?? section.rows[0].academic_year_id;
  const result = await pool.query(
    `INSERT INTO erp_timetables (
       tenant_id, branch_id, section_id, academic_year_id, title, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, section_id, academic_year_id) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, erp_timetables.title),
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      section.rows[0].branch_id || branchId,
      input.section_id,
      yearId,
      input.title ?? null,
      userId,
    ],
  );
  return result.rows[0];
}

export async function getTimetable(tenantId: string, timetableId: string) {
  const tt = await pool.query(
    `SELECT t.*, s.name AS section_name, g.name AS grade_name
     FROM erp_timetables t
     JOIN sections s ON s.id = t.section_id
     JOIN grade_levels g ON g.id = s.grade_level_id
     WHERE t.id = $1 AND t.tenant_id = $2`,
    [timetableId, tenantId],
  );
  if (!tt.rowCount) throw new HttpError(404, 'Timetable not found');

  const slots = await pool.query(
    `SELECT sl.*, sub.name AS subject_name, sub.color AS subject_color
     FROM erp_timetable_slots sl
     LEFT JOIN erp_subjects sub ON sub.id = sl.subject_id
     WHERE sl.timetable_id = $1 AND sl.tenant_id = $2
     ORDER BY sl.day_of_week, sl.period_number`,
    [timetableId, tenantId],
  );

  const settings = await getSettings(tenantId);
  return { timetable: tt.rows[0], slots: slots.rows, settings };
}

export async function replaceSlots(
  tenantId: string,
  timetableId: string,
  input: z.infer<typeof ReplaceSlotsSchema>,
) {
  const tt = await pool.query(
    `SELECT id, status FROM erp_timetables WHERE id = $1 AND tenant_id = $2`,
    [timetableId, tenantId],
  );
  if (!tt.rowCount) throw new HttpError(404, 'Timetable not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM erp_timetable_slots WHERE timetable_id = $1 AND tenant_id = $2`, [
      timetableId,
      tenantId,
    ]);

    for (const slot of input.slots) {
      await client.query(
        `INSERT INTO erp_timetable_slots (
           tenant_id, timetable_id, day_of_week, period_number,
           subject_id, teacher_name, room, slot_type, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          tenantId,
          timetableId,
          slot.day_of_week,
          slot.period_number,
          slot.subject_id ?? null,
          slot.teacher_name ?? null,
          slot.room ?? null,
          slot.slot_type ?? 'lesson',
          slot.notes ?? null,
        ],
      );
    }

    await client.query(
      `UPDATE erp_timetables SET status = 'draft', updated_at = NOW() WHERE id = $1`,
      [timetableId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getTimetable(tenantId, timetableId);
}

export async function publishTimetable(tenantId: string, timetableId: string) {
  const result = await pool.query(
    `UPDATE erp_timetables
     SET status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [timetableId, tenantId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Timetable not found');
  return result.rows[0];
}

/** Seed default Arabic subjects for a new school ERP. */
export async function seedDefaultSubjects(tenantId: string, branchId?: string | null) {
  const defaults = [
    { name: 'اللغة العربية', code: 'AR', color: '#0EA5E9' },
    { name: 'الرياضيات', code: 'MATH', color: '#4F46E5' },
    { name: 'العلوم', code: 'SCI', color: '#10B981' },
    { name: 'اللغة الإنجليزية', code: 'EN', color: '#F59E0B' },
    { name: 'الدراسات الاجتماعية', code: 'SS', color: '#8B5CF6' },
    { name: 'التربية الرياضية', code: 'PE', color: '#EF4444' },
  ];
  const rows = [];
  for (const d of defaults) {
    rows.push(await createSubject(tenantId, { ...d, branch_id: branchId ?? undefined }));
  }
  return rows;
}
