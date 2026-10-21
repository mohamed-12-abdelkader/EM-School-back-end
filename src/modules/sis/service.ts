import { randomUUID } from 'node:crypto';
import pool from '../../db/pool';
import { HttpError } from '../../utils';
import { enqueueAttendanceAlert, enqueueMessagingFallback } from '../../workers/queues';
import type { z } from 'zod';
import type {
  BatchAttendanceSchema,
  CreateBehaviorSchema,
  CreateClinicVisitSchema,
  CreateFamilyGroupSchema,
  CreateGuardianSchema,
  CreateStudentSchema,
  QrDismissalSchema,
  UpdateMedicalSchema,
  UpsertAttendanceSchema,
  UpsertBellScheduleSchema,
} from './schemas';

const SUMMONS_THRESHOLD = 10;

export async function createFamilyGroup(
  tenantId: string,
  input: z.infer<typeof CreateFamilyGroupSchema>,
) {
  const result = await pool.query(
    `INSERT INTO family_groups (tenant_id, display_name, notes)
     VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, input.display_name, input.notes ?? null],
  );
  return result.rows[0];
}

export async function listFamilyStudents(tenantId: string, familyGroupId: string) {
  const result = await pool.query(
    `SELECT * FROM students WHERE tenant_id = $1 AND family_group_id = $2 ORDER BY full_name`,
    [tenantId, familyGroupId],
  );
  return result.rows;
}

export async function createGuardian(
  tenantId: string,
  input: z.infer<typeof CreateGuardianSchema>,
) {
  const token = randomUUID();
  const result = await pool.query(
    `INSERT INTO student_guardians (
      tenant_id, family_group_id, user_id, full_name, relationship, phone, email,
      is_primary, has_custody, is_financially_responsible, is_emergency_contact, can_pickup, pickup_qr_token
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      tenantId,
      input.family_group_id,
      input.user_id ?? null,
      input.full_name,
      input.relationship,
      input.phone ?? null,
      input.email ?? null,
      input.is_primary,
      input.has_custody,
      input.is_financially_responsible,
      input.is_emergency_contact,
      input.can_pickup,
      token,
    ],
  );
  return result.rows[0];
}

export async function createStudent(tenantId: string, input: z.infer<typeof CreateStudentSchema>) {
  const medical = input.medical_profile ?? {
    allergies: [],
    conditions: [],
    emergency_notes: '',
  };

  const result = await pool.query(
    `INSERT INTO students (
      tenant_id, branch_id, family_group_id, student_code, full_name,
      grade_level_id, date_of_birth, gender, national_id,
      rfid_card_uid, biometric_device_user_id, current_section_id, medical_profile
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.family_group_id,
      input.student_code,
      input.full_name,
      input.grade_level_id ?? null,
      input.date_of_birth ?? null,
      input.gender ?? null,
      input.national_id ?? null,
      input.rfid_card_uid ?? null,
      input.biometric_device_user_id ?? null,
      input.current_section_id ?? null,
      JSON.stringify(medical),
    ],
  );
  return result.rows[0];
}

export async function listStudents(tenantId: string, branchId?: string | null) {
  const result = await pool.query(
    `SELECT * FROM students
     WHERE tenant_id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
     ORDER BY full_name`,
    [tenantId, branchId ?? null],
  );
  return result.rows;
}

export async function getStudent360(tenantId: string, studentId: string) {
  const student = await pool.query(`SELECT * FROM students WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    studentId,
  ]);
  if (!student.rowCount) throw new HttpError(404, 'Student not found');

  const [guardians, siblings, clinic, behavior] = await Promise.all([
    pool.query(
      `SELECT * FROM student_guardians WHERE tenant_id = $1 AND family_group_id = $2`,
      [tenantId, student.rows[0].family_group_id],
    ),
    pool.query(
      `SELECT id, full_name, student_code, branch_id, grade_level_id, lifecycle_status
       FROM students WHERE tenant_id = $1 AND family_group_id = $2 AND id <> $3`,
      [tenantId, student.rows[0].family_group_id, studentId],
    ),
    pool.query(
      `SELECT * FROM clinic_visits WHERE tenant_id = $1 AND student_id = $2
       ORDER BY visited_at DESC LIMIT 20`,
      [tenantId, studentId],
    ),
    pool.query(
      `SELECT * FROM behavior_incidents WHERE tenant_id = $1 AND student_id = $2
       ORDER BY occurred_at DESC LIMIT 20`,
      [tenantId, studentId],
    ),
  ]);

  return {
    student: student.rows[0],
    guardians: guardians.rows,
    siblings: siblings.rows,
    clinic_visits: clinic.rows,
    behavior_incidents: behavior.rows,
  };
}

export async function updateMedical(
  tenantId: string,
  studentId: string,
  input: z.infer<typeof UpdateMedicalSchema>,
) {
  const result = await pool.query(
    `UPDATE students SET medical_profile = $3::jsonb, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, studentId, JSON.stringify(input.medical_profile)],
  );
  if (!result.rowCount) throw new HttpError(404, 'Student not found');
  return result.rows[0];
}

export async function createClinicVisit(
  tenantId: string,
  userId: string | undefined,
  input: z.infer<typeof CreateClinicVisitSchema>,
) {
  const result = await pool.query(
    `INSERT INTO clinic_visits (
      tenant_id, branch_id, student_id, visited_at, symptoms, treatment,
      nurse_notes, parent_contacted, recorded_by
    ) VALUES ($1,$2,$3,COALESCE($4::timestamptz, NOW()),$5,$6,$7,$8,$9)
    RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.student_id,
      input.visited_at ?? null,
      input.symptoms,
      input.treatment ?? null,
      input.nurse_notes ?? null,
      input.parent_contacted,
      userId ?? null,
    ],
  );

  if (input.parent_contacted) {
    await enqueueMessagingFallback({
      tenantId,
      channel: 'PUSH',
      recipient: input.student_id,
      payload: { type: 'CLINIC_VISIT', visitId: result.rows[0].id },
    });
  }

  return result.rows[0];
}

export async function createBehaviorIncident(
  tenantId: string,
  userId: string | undefined,
  input: z.infer<typeof CreateBehaviorSchema>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const summons =
      input.parent_summons_required ??
      (input.incident_type === 'SUMMONS' || Math.abs(input.points) >= SUMMONS_THRESHOLD);

    const incident = await client.query(
      `INSERT INTO behavior_incidents (
        tenant_id, branch_id, student_id, incident_type, category, points,
        description, badge_code, parent_summons_required, recorded_by, occurred_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, NOW()))
      RETURNING *`,
      [
        tenantId,
        input.branch_id,
        input.student_id,
        input.incident_type,
        input.category ?? null,
        input.points,
        input.description,
        input.badge_code ?? null,
        summons,
        userId ?? null,
        input.occurred_at ?? null,
      ],
    );

    const student = await client.query(
      `UPDATE students SET
        disciplinary_points = disciplinary_points + $3,
        updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, input.student_id, input.points],
    );

    await client.query('COMMIT');

    if (summons || student.rows[0].disciplinary_points >= SUMMONS_THRESHOLD) {
      await enqueueMessagingFallback({
        tenantId,
        channel: 'PUSH',
        recipient: input.student_id,
        payload: {
          type: 'BEHAVIOR_SUMMONS',
          incidentId: incident.rows[0].id,
          points: student.rows[0].disciplinary_points,
        },
      });
    }

    return { incident: incident.rows[0], student: student.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertAttendance(
  tenantId: string,
  input: z.infer<typeof UpsertAttendanceSchema>,
  recordedBy?: string,
) {
  const result = await pool.query(
    `INSERT INTO attendance_logs (
      tenant_id, student_id, section_id, attendance_date, period_number,
      status, source, check_in_at, late_minutes, notes, recorded_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (tenant_id, student_id, attendance_date, period_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      check_in_at = COALESCE(EXCLUDED.check_in_at, attendance_logs.check_in_at),
      late_minutes = EXCLUDED.late_minutes,
      notes = COALESCE(EXCLUDED.notes, attendance_logs.notes),
      recorded_by = COALESCE(EXCLUDED.recorded_by, attendance_logs.recorded_by)
    RETURNING *`,
    [
      tenantId,
      input.student_id,
      input.section_id,
      input.attendance_date,
      input.period_number,
      input.status,
      input.source,
      input.check_in_at ?? null,
      input.late_minutes,
      input.notes ?? null,
      recordedBy ?? null,
    ],
  );

  const row = result.rows[0];
  if (row.status === 'ABSENT' || row.status === 'LATE') {
    await enqueueAttendanceAlert({
      tenantId,
      studentId: row.student_id,
      status: row.status,
      attendanceDate: String(row.attendance_date).slice(0, 10),
    });
  }
  return row;
}

export async function batchAttendance(
  tenantId: string,
  input: z.infer<typeof BatchAttendanceSchema>,
  recordedBy?: string,
) {
  const results = [];
  for (const entry of input.entries) {
    results.push(await upsertAttendance(tenantId, entry, recordedBy));
  }
  return { count: results.length, rows: results };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export async function ingestHardwarePunch(
  tenantId: string,
  payload: {
    rfid_card_uid?: string;
    biometric_device_user_id?: string;
    occurred_at: string;
    event_type: 'CHECK_IN' | 'CHECK_OUT';
  },
) {
  if (!payload.rfid_card_uid && !payload.biometric_device_user_id) {
    throw new HttpError(400, 'RFID or biometric identifier required');
  }

  const studentResult = await pool.query(
    `SELECT id, current_section_id, branch_id FROM students
     WHERE tenant_id = $1
       AND (
         ($2::text IS NOT NULL AND rfid_card_uid = $2)
         OR ($3::text IS NOT NULL AND biometric_device_user_id = $3)
       )
     LIMIT 1`,
    [tenantId, payload.rfid_card_uid ?? null, payload.biometric_device_user_id ?? null],
  );
  if (!studentResult.rowCount) throw new HttpError(404, 'Student not found for hardware identifier');

  const student = studentResult.rows[0];
  if (!student.current_section_id) throw new HttpError(400, 'Student has no assigned section');

  let lateMinutes = 0;
  let status: 'PRESENT' | 'LATE' = 'PRESENT';
  const bell = await pool.query(
    `SELECT late_after FROM bell_schedules
     WHERE tenant_id = $1 AND branch_id = $2 AND is_active
     ORDER BY name LIMIT 1`,
    [tenantId, student.branch_id],
  );
  if (bell.rowCount) {
    const occurred = new Date(payload.occurred_at);
    const mins = occurred.getUTCHours() * 60 + occurred.getUTCMinutes();
    const lateAfter = timeToMinutes(String(bell.rows[0].late_after).slice(0, 5));
    if (mins > lateAfter) {
      status = 'LATE';
      lateMinutes = mins - lateAfter;
    }
  }

  return upsertAttendance(tenantId, {
    student_id: student.id,
    section_id: student.current_section_id,
    attendance_date: payload.occurred_at.slice(0, 10),
    period_number: 0,
    status,
    source: payload.rfid_card_uid ? 'RFID_GATE' : 'BIOMETRIC',
    check_in_at: payload.occurred_at,
    late_minutes: lateMinutes,
  });
}

export async function qrGateDismissal(
  tenantId: string,
  verifiedBy: string | undefined,
  input: z.infer<typeof QrDismissalSchema>,
) {
  const guardian = await pool.query(
    `SELECT * FROM student_guardians
     WHERE tenant_id = $1 AND pickup_qr_token = $2 AND can_pickup = TRUE`,
    [tenantId, input.pickup_qr_token],
  );
  if (!guardian.rowCount) throw new HttpError(403, 'Invalid or unauthorized pickup QR');

  const student = await pool.query(
    `SELECT * FROM students WHERE tenant_id = $1 AND id = $2 AND family_group_id = $3`,
    [tenantId, input.student_id, guardian.rows[0].family_group_id],
  );
  if (!student.rowCount) throw new HttpError(403, 'Student not linked to this guardian');

  const result = await pool.query(
    `INSERT INTO gate_dismissals
      (tenant_id, branch_id, student_id, guardian_id, method, verified_by, notes)
     VALUES ($1,$2,$3,$4,'QR_PICKUP',$5,$6) RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.student_id,
      guardian.rows[0].id,
      verifiedBy ?? null,
      input.notes ?? null,
    ],
  );

  await enqueueMessagingFallback({
    tenantId,
    channel: 'PUSH',
    recipient: input.student_id,
    payload: { type: 'GATE_DISMISSAL', dismissalId: result.rows[0].id },
  });

  return result.rows[0];
}

export async function upsertBellSchedule(
  tenantId: string,
  input: z.infer<typeof UpsertBellScheduleSchema>,
) {
  const result = await pool.query(
    `INSERT INTO bell_schedules
      (tenant_id, branch_id, name, day_of_week, morning_start, late_after, period_ends)
     VALUES ($1,$2,$3,$4,$5::time,$6::time,$7::jsonb)
     ON CONFLICT (tenant_id, branch_id, name)
     DO UPDATE SET
       day_of_week = EXCLUDED.day_of_week,
       morning_start = EXCLUDED.morning_start,
       late_after = EXCLUDED.late_after,
       period_ends = EXCLUDED.period_ends,
       is_active = TRUE
     RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.name,
      input.day_of_week ?? null,
      input.morning_start,
      input.late_after,
      JSON.stringify(input.period_ends),
    ],
  );
  return result.rows[0];
}

export async function parentChildren(tenantId: string, userId: string) {
  const result = await pool.query(
    `SELECT DISTINCT s.*
     FROM students s
     JOIN student_guardians g ON g.family_group_id = s.family_group_id AND g.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1 AND g.user_id = $2 AND s.lifecycle_status = 'ACTIVE'
     ORDER BY s.full_name`,
    [tenantId, userId],
  );
  return result.rows;
}
