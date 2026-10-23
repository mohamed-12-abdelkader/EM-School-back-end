import pool from '../db/pool';

export type StudentNotificationKind =
  | 'lesson'
  | 'exam'
  | 'task'
  | 'grade'
  | 'announcement';

/** Notify every active student in a classroom. */
export async function notifyClassroomStudents(opts: {
  schoolId: number;
  classroomId: number;
  kind: StudentNotificationKind;
  title: string;
  body: string;
  href?: string | null;
  refType?: string | null;
  refId?: number | null;
}) {
  await pool.query(
    `INSERT INTO student_notifications
       (student_id, school_id, kind, title, body, href, ref_type, ref_id)
     SELECT u.id, $1, $2, $3, $4, $5, $6, $7
     FROM student_profiles sp
     JOIN users u ON u.id = sp.user_id
     WHERE sp.classroom_id = $8
       AND u.school_id = $1
       AND u.role = 'student'
       AND u.deleted_at IS NULL
       AND u.is_active IS DISTINCT FROM FALSE
       AND sp.status = 'active'`,
    [
      opts.schoolId,
      opts.kind,
      opts.title,
      opts.body,
      opts.href ?? null,
      opts.refType ?? null,
      opts.refId ?? null,
      opts.classroomId,
    ],
  );
}

export async function notifyStudent(opts: {
  studentId: number;
  schoolId: number;
  kind: StudentNotificationKind;
  title: string;
  body: string;
  href?: string | null;
  refType?: string | null;
  refId?: number | null;
}) {
  await pool.query(
    `INSERT INTO student_notifications
       (student_id, school_id, kind, title, body, href, ref_type, ref_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      opts.studentId,
      opts.schoolId,
      opts.kind,
      opts.title,
      opts.body,
      opts.href ?? null,
      opts.refType ?? null,
      opts.refId ?? null,
    ],
  );
}
