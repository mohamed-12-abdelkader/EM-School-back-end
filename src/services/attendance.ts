import { Pool, PoolClient } from 'pg';
import pool from '../db/pool';
import { HttpError } from '../utils';
import { parseQrPayload } from './accessCodes';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type CheckInMethod = 'qr' | 'manual';

export type AttendanceRecord = {
  id: number;
  school_id: number;
  student_id: number;
  attendance_date: string;
  status: AttendanceStatus;
  check_in_time: string | null;
  check_in_method: CheckInMethod | null;
  absence_reason: string | null;
  notes: string | null;
  excuse_approved: boolean | null;
  recorded_by: number | null;
  updated_by: number | null;
  edit_reason: string | null;
  created_at: string;
  updated_at: string;
  student_name?: string;
  grade_id?: number;
  grade_name?: string;
  classroom_id?: number;
  classroom_name?: string;
};

type DbClient = Pool | PoolClient;

const ATTENDANCE_SELECT = `
  SELECT
    a.id,
    a.school_id,
    a.student_id,
    a.attendance_date::text AS attendance_date,
    a.status,
    a.check_in_time,
    a.check_in_method,
    a.absence_reason,
    a.notes,
    a.excuse_approved,
    a.recorded_by,
    a.updated_by,
    a.edit_reason,
    a.created_at,
    a.updated_at,
    u.name AS student_name,
    sp.grade_id,
    g.name AS grade_name,
    sp.classroom_id,
    c.name AS classroom_name
  FROM attendance_records a
  JOIN users u ON u.id = a.student_id
  JOIN student_profiles sp ON sp.user_id = a.student_id
  JOIN grades g ON g.id = sp.grade_id
  JOIN classrooms c ON c.id = sp.classroom_id
`;

export function todayDateString(timeZone = 'Africa/Cairo'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function calcAttendanceRate(presentLike: number, recordedDays: number): number {
  if (recordedDays <= 0) return 0;
  return Math.round((presentLike / recordedDays) * 10000) / 100;
}

export async function resolveStudentFromQr(params: {
  schoolId: number;
  qrPayload?: string;
  qrToken?: string;
}) {
  let token = params.qrToken;
  if (!token && params.qrPayload) {
    const parsed = parseQrPayload(params.qrPayload);
    if (!parsed) throw new HttpError(400, 'Invalid QR payload format');
    if (parsed.schoolId !== params.schoolId) {
      throw new HttpError(403, 'QR belongs to another school');
    }
    token = parsed.qrToken;
  }
  if (!token) throw new HttpError(400, 'qr_payload or qr_token is required');

  const result = await pool.query(
    `SELECT
       u.id, u.name, u.school_id, u.login_code, u.qr_token,
       sp.grade_id, g.name AS grade_name,
       sp.classroom_id, c.name AS classroom_name,
       sp.academic_year, sp.status AS student_status
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     JOIN grades g ON g.id = sp.grade_id
     JOIN classrooms c ON c.id = sp.classroom_id
     WHERE u.qr_token = $1
       AND u.school_id = $2
       AND u.role = 'student'
       AND u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND sp.status = 'active'`,
    [token, params.schoolId],
  );

  if (!result.rowCount) {
    throw new HttpError(404, 'Invalid or inactive student QR');
  }

  return result.rows[0];
}

export async function assertSchoolStudent(
  schoolId: number,
  studentId: number,
  opts?: { gradeId?: number; classroomId?: number },
) {
  const values: unknown[] = [studentId, schoolId];
  let i = 3;
  const conditions = [
    'u.id = $1',
    'u.school_id = $2',
    "u.role = 'student'",
    'u.deleted_at IS NULL',
    "sp.status = 'active'",
  ];

  if (opts?.gradeId) {
    conditions.push(`sp.grade_id = $${i++}`);
    values.push(opts.gradeId);
  }
  if (opts?.classroomId) {
    conditions.push(`sp.classroom_id = $${i++}`);
    values.push(opts.classroomId);
  }

  const result = await pool.query(
    `SELECT
       u.id, u.name, sp.grade_id, g.name AS grade_name,
       sp.classroom_id, c.name AS classroom_name, sp.academic_year
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     JOIN grades g ON g.id = sp.grade_id
     JOIN classrooms c ON c.id = sp.classroom_id
     WHERE ${conditions.join(' AND ')}`,
    values,
  );

  if (!result.rowCount) {
    throw new HttpError(404, 'Student not found in your school (or inactive / wrong class)');
  }
  return result.rows[0];
}

async function writeAudit(
  client: DbClient,
  params: {
    attendanceId: number;
    schoolId: number;
    studentId: number;
    action: string;
    oldStatus?: AttendanceStatus | null;
    newStatus?: AttendanceStatus | null;
    oldValues?: unknown;
    newValues?: unknown;
    reason?: string | null;
    changedBy?: number | null;
  },
) {
  await client.query(
    `INSERT INTO attendance_audit_logs
       (attendance_id, school_id, student_id, action, old_status, new_status,
        old_values, new_values, reason, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [
      params.attendanceId,
      params.schoolId,
      params.studentId,
      params.action,
      params.oldStatus ?? null,
      params.newStatus ?? null,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      params.reason ?? null,
      params.changedBy ?? null,
    ],
  );
}

export async function upsertAttendance(params: {
  schoolId: number;
  studentId: number;
  attendanceDate: string;
  status: AttendanceStatus;
  checkInMethod: CheckInMethod;
  checkInTime?: Date | null;
  absenceReason?: string | null;
  notes?: string | null;
  excuseApproved?: boolean | null;
  actorId: number;
  editReason?: string | null;
  allowAlreadyPresentAsSuccess?: boolean;
}): Promise<{ record: AttendanceRecord; created: boolean; already_recorded: boolean }> {
  if (!isIsoDate(params.attendanceDate)) {
    throw new HttpError(400, 'attendance_date must be YYYY-MM-DD');
  }

  if (
    (params.status === 'absent' || params.status === 'excused') &&
    params.absenceReason !== undefined &&
    params.absenceReason !== null &&
    !String(params.absenceReason).trim()
  ) {
    throw new HttpError(400, 'absence_reason cannot be empty');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT * FROM attendance_records
       WHERE school_id = $1 AND student_id = $2 AND attendance_date = $3::date
         AND cancelled_at IS NULL
       FOR UPDATE`,
      [params.schoolId, params.studentId, params.attendanceDate],
    );

    if (existing.rowCount) {
      const current = existing.rows[0];

      // QR re-scan of an already-present student
      if (
        params.allowAlreadyPresentAsSuccess &&
        params.checkInMethod === 'qr' &&
        (current.status === 'present' || current.status === 'late')
      ) {
        await client.query('COMMIT');
        const full = await pool.query(`${ATTENDANCE_SELECT} WHERE a.id = $1`, [current.id]);
        return {
          record: full.rows[0],
          created: false,
          already_recorded: true,
        };
      }

      const updated = await client.query(
        `UPDATE attendance_records
         SET status = $1,
             check_in_time = COALESCE($2, check_in_time),
             check_in_method = COALESCE($3, check_in_method),
             absence_reason = $4,
             notes = COALESCE($5, notes),
             excuse_approved = COALESCE($6, excuse_approved),
             updated_by = $7,
             edit_reason = $8,
             updated_at = NOW()
         WHERE id = $9
         RETURNING id`,
        [
          params.status,
          params.checkInTime ?? null,
          params.checkInMethod,
          params.absenceReason ?? null,
          params.notes ?? null,
          params.excuseApproved ?? null,
          params.actorId,
          params.editReason ?? null,
          current.id,
        ],
      );

      await writeAudit(client, {
        attendanceId: updated.rows[0].id,
        schoolId: params.schoolId,
        studentId: params.studentId,
        action: 'update',
        oldStatus: current.status,
        newStatus: params.status,
        oldValues: {
          status: current.status,
          absence_reason: current.absence_reason,
          notes: current.notes,
          excuse_approved: current.excuse_approved,
        },
        newValues: {
          status: params.status,
          absence_reason: params.absenceReason ?? null,
          notes: params.notes ?? null,
          excuse_approved: params.excuseApproved ?? null,
        },
        reason: params.editReason ?? null,
        changedBy: params.actorId,
      });

      await client.query('COMMIT');
      const full = await pool.query(`${ATTENDANCE_SELECT} WHERE a.id = $1`, [updated.rows[0].id]);
      return { record: full.rows[0], created: false, already_recorded: false };
    }

    const checkInTime =
      params.checkInTime ??
      (params.status === 'present' || params.status === 'late' ? new Date() : null);

    try {
      const inserted = await client.query(
        `INSERT INTO attendance_records
           (school_id, student_id, attendance_date, status, check_in_time, check_in_method,
            absence_reason, notes, excuse_approved, recorded_by, updated_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$10)
         RETURNING id`,
        [
          params.schoolId,
          params.studentId,
          params.attendanceDate,
          params.status,
          checkInTime,
          params.checkInMethod,
          params.absenceReason ?? null,
          params.notes ?? null,
          params.excuseApproved ?? (params.status === 'excused' ? false : null),
          params.actorId,
        ],
      );

      await writeAudit(client, {
        attendanceId: inserted.rows[0].id,
        schoolId: params.schoolId,
        studentId: params.studentId,
        action: 'create',
        oldStatus: null,
        newStatus: params.status,
        newValues: {
          status: params.status,
          check_in_method: params.checkInMethod,
          absence_reason: params.absenceReason ?? null,
        },
        changedBy: params.actorId,
      });

      await client.query('COMMIT');
      const full = await pool.query(`${ATTENDANCE_SELECT} WHERE a.id = $1`, [inserted.rows[0].id]);
      return { record: full.rows[0], created: true, already_recorded: false };
    } catch (error: any) {
      // Concurrent insert race → retry as update path
      if (error?.code === '23505') {
        await client.query('ROLLBACK');
        return upsertAttendance(params);
      }
      throw error;
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getAttendanceById(schoolId: number, id: number) {
  const result = await pool.query(
    `${ATTENDANCE_SELECT}
     WHERE a.id = $1 AND a.school_id = $2 AND a.cancelled_at IS NULL`,
    [id, schoolId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Attendance record not found');
  return result.rows[0] as AttendanceRecord;
}

export async function listAttendance(params: {
  schoolId: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  gradeId?: number;
  classroomId?: number;
  studentId?: number;
  status?: AttendanceStatus;
  limit?: number;
  skip?: number;
}) {
  const values: unknown[] = [params.schoolId];
  const conditions = ['a.school_id = $1', 'a.cancelled_at IS NULL'];
  let i = 2;

  if (params.date) {
    conditions.push(`a.attendance_date = $${i++}::date`);
    values.push(params.date);
  }
  if (params.dateFrom) {
    conditions.push(`a.attendance_date >= $${i++}::date`);
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push(`a.attendance_date <= $${i++}::date`);
    values.push(params.dateTo);
  }
  if (params.gradeId) {
    conditions.push(`sp.grade_id = $${i++}`);
    values.push(params.gradeId);
  }
  if (params.classroomId) {
    conditions.push(`sp.classroom_id = $${i++}`);
    values.push(params.classroomId);
  }
  if (params.studentId) {
    conditions.push(`a.student_id = $${i++}`);
    values.push(params.studentId);
  }
  if (params.status) {
    conditions.push(`a.status = $${i++}`);
    values.push(params.status);
  }

  const whereSQL = `WHERE ${conditions.join(' AND ')}`;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const skip = Math.max(params.skip ?? 0, 0);

  const count = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM attendance_records a
     JOIN student_profiles sp ON sp.user_id = a.student_id
     ${whereSQL}`,
    values,
  );

  values.push(limit, skip);
  const rows = await pool.query(
    `${ATTENDANCE_SELECT}
     ${whereSQL}
     ORDER BY a.attendance_date DESC, c.name ASC, u.name ASC
     LIMIT $${i} OFFSET $${i + 1}`,
    values,
  );

  return {
    records: rows.rows as AttendanceRecord[],
    total: count.rows[0].total as number,
    limit,
    skip,
  };
}

export async function listUnrecordedStudents(params: {
  schoolId: number;
  date: string;
  gradeId?: number;
  classroomId?: number;
}) {
  const values: unknown[] = [params.schoolId, params.date];
  const conditions = [
    'u.school_id = $1',
    "u.role = 'student'",
    'u.deleted_at IS NULL',
    "sp.status = 'active'",
    `NOT EXISTS (
       SELECT 1 FROM attendance_records a
       WHERE a.student_id = u.id
         AND a.school_id = u.school_id
         AND a.attendance_date = $2::date
         AND a.cancelled_at IS NULL
     )`,
  ];
  let i = 3;

  if (params.gradeId) {
    conditions.push(`sp.grade_id = $${i++}`);
    values.push(params.gradeId);
  }
  if (params.classroomId) {
    conditions.push(`sp.classroom_id = $${i++}`);
    values.push(params.classroomId);
  }

  const result = await pool.query(
    `SELECT
       u.id, u.name, u.login_code,
       sp.grade_id, g.name AS grade_name,
       sp.classroom_id, c.name AS classroom_name
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     JOIN grades g ON g.id = sp.grade_id
     JOIN classrooms c ON c.id = sp.classroom_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY g.name, c.name, u.name`,
    values,
  );

  return result.rows;
}

export async function getDailySummary(params: {
  schoolId: number;
  date: string;
  gradeId?: number;
  classroomId?: number;
}) {
  const studentValues: unknown[] = [params.schoolId];
  const studentFilters = [
    'u.school_id = $1',
    "u.role = 'student'",
    'u.deleted_at IS NULL',
    "sp.status = 'active'",
  ];
  let si = 2;
  if (params.gradeId) {
    studentFilters.push(`sp.grade_id = $${si++}`);
    studentValues.push(params.gradeId);
  }
  if (params.classroomId) {
    studentFilters.push(`sp.classroom_id = $${si++}`);
    studentValues.push(params.classroomId);
  }

  const totals = await pool.query(
    `SELECT COUNT(*)::int AS total_students
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     WHERE ${studentFilters.join(' AND ')}`,
    studentValues,
  );

  const statusValues: unknown[] = [params.schoolId, params.date];
  const statusFilters = [
    'a.school_id = $1',
    'a.attendance_date = $2::date',
    'a.cancelled_at IS NULL',
    "u.role = 'student'",
    'u.deleted_at IS NULL',
    "sp.status = 'active'",
  ];
  let ai = 3;
  if (params.gradeId) {
    statusFilters.push(`sp.grade_id = $${ai++}`);
    statusValues.push(params.gradeId);
  }
  if (params.classroomId) {
    statusFilters.push(`sp.classroom_id = $${ai++}`);
    statusValues.push(params.classroomId);
  }

  const byStatus = await pool.query(
    `SELECT a.status, COUNT(*)::int AS count
     FROM attendance_records a
     JOIN users u ON u.id = a.student_id
     JOIN student_profiles sp ON sp.user_id = u.id
     WHERE ${statusFilters.join(' AND ')}
     GROUP BY a.status`,
    statusValues,
  );

  const counts: Record<string, number> = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
  };
  for (const row of byStatus.rows) {
    counts[row.status] = row.count;
  }

  const totalStudents = totals.rows[0].total_students as number;
  const recorded =
    counts.present + counts.absent + counts.late + counts.excused;
  const notRecorded = Math.max(totalStudents - recorded, 0);
  const presentLike = counts.present + counts.late;
  const attendanceRate = calcAttendanceRate(presentLike, recorded);

  return {
    date: params.date,
    total_students: totalStudents,
    present: counts.present,
    absent: counts.absent,
    late: counts.late,
    excused: counts.excused,
    not_recorded: notRecorded,
    recorded,
    attendance_rate: attendanceRate,
    attendance_rate_basis: 'recorded_students_only',
  };
}

export async function getStudentSummary(params: {
  schoolId: number;
  studentId: number;
  dateFrom: string;
  dateTo: string;
}) {
  await assertSchoolStudent(params.schoolId, params.studentId);

  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'present')::int AS present_days,
       COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_days,
       COUNT(*) FILTER (WHERE status = 'late')::int AS late_days,
       COUNT(*) FILTER (WHERE status = 'excused')::int AS excused_days,
       COUNT(*)::int AS recorded_days
     FROM attendance_records
     WHERE school_id = $1
       AND student_id = $2
       AND cancelled_at IS NULL
       AND attendance_date BETWEEN $3::date AND $4::date`,
    [params.schoolId, params.studentId, params.dateFrom, params.dateTo],
  );

  const row = result.rows[0];
  const presentLike = row.present_days + row.late_days;

  return {
    student_id: params.studentId,
    date_from: params.dateFrom,
    date_to: params.dateTo,
    present_days: row.present_days,
    absent_days: row.absent_days,
    late_days: row.late_days,
    excused_days: row.excused_days,
    recorded_days: row.recorded_days,
    attendance_rate: calcAttendanceRate(presentLike, row.recorded_days),
    attendance_rate_basis: 'recorded_days_only',
  };
}

export async function getFrequentAbsences(params: {
  schoolId: number;
  dateFrom: string;
  dateTo: string;
  minAbsences?: number;
  gradeId?: number;
  classroomId?: number;
  limit?: number;
}) {
  const minAbsences = params.minAbsences ?? 3;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const values: unknown[] = [params.schoolId, params.dateFrom, params.dateTo, minAbsences];
  const filters = [
    'a.school_id = $1',
    'a.cancelled_at IS NULL',
    "a.status IN ('absent', 'excused')",
    'a.attendance_date BETWEEN $2::date AND $3::date',
    'u.deleted_at IS NULL',
  ];
  let i = 5;
  if (params.gradeId) {
    filters.push(`sp.grade_id = $${i++}`);
    values.push(params.gradeId);
  }
  if (params.classroomId) {
    filters.push(`sp.classroom_id = $${i++}`);
    values.push(params.classroomId);
  }
  values.push(limit);

  const result = await pool.query(
    `SELECT
       u.id AS student_id,
       u.name AS student_name,
       sp.grade_id,
       g.name AS grade_name,
       sp.classroom_id,
       c.name AS classroom_name,
       COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent_days,
       COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused_days,
       COUNT(*)::int AS total_absence_days
     FROM attendance_records a
     JOIN users u ON u.id = a.student_id
     JOIN student_profiles sp ON sp.user_id = u.id
     JOIN grades g ON g.id = sp.grade_id
     JOIN classrooms c ON c.id = sp.classroom_id
     WHERE ${filters.join(' AND ')}
     GROUP BY u.id, u.name, sp.grade_id, g.name, sp.classroom_id, c.name
     HAVING COUNT(*) >= $4
     ORDER BY total_absence_days DESC, u.name ASC
     LIMIT $${i}`,
    values,
  );

  return result.rows;
}

export async function cancelAttendance(params: {
  schoolId: number;
  attendanceId: number;
  actorId: number;
  reason?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM attendance_records
       WHERE id = $1 AND school_id = $2 AND cancelled_at IS NULL
       FOR UPDATE`,
      [params.attendanceId, params.schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Attendance record not found');

    const current = existing.rows[0];
    await client.query(
      `UPDATE attendance_records
       SET cancelled_at = NOW(), cancelled_by = $1, updated_by = $1,
           edit_reason = $2, updated_at = NOW()
       WHERE id = $3`,
      [params.actorId, params.reason ?? null, params.attendanceId],
    );

    await writeAudit(client, {
      attendanceId: params.attendanceId,
      schoolId: params.schoolId,
      studentId: current.student_id,
      action: 'cancel',
      oldStatus: current.status,
      newStatus: null,
      reason: params.reason ?? null,
      changedBy: params.actorId,
      oldValues: { status: current.status },
    });

    await client.query('COMMIT');
    return { id: params.attendanceId, cancelled: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function recordsToCsv(records: AttendanceRecord[]): string {
  const header = [
    'id',
    'date',
    'student_id',
    'student_name',
    'grade',
    'classroom',
    'status',
    'check_in_time',
    'check_in_method',
    'absence_reason',
    'notes',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const r of records) {
    lines.push(
      [
        r.id,
        r.attendance_date,
        r.student_id,
        r.student_name,
        r.grade_name,
        r.classroom_name,
        r.status,
        r.check_in_time,
        r.check_in_method,
        r.absence_reason,
        r.notes,
      ]
        .map(escape)
        .join(','),
    );
  }
  return lines.join('\n');
}
