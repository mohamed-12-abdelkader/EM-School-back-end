import pool from '../db/pool';

export async function listChildren(parentId: number, schoolId: number) {
  return pool.query(
    `SELECT
       u.id AS student_id,
       u.name AS student_name,
       u.avatar,
       ps.relation,
       ps.is_primary,
       sp.status,
       sp.academic_year,
       sp.grade_id,
       sp.classroom_id,
       sp.seat_number,
       g.name AS grade_name,
       c.name AS classroom_name
     FROM parent_students ps
     JOIN users u ON u.id = ps.student_id
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN grades g ON g.id = sp.grade_id
     LEFT JOIN classrooms c ON c.id = sp.classroom_id
     WHERE ps.parent_id = $1
       AND u.school_id = $2
       AND u.deleted_at IS NULL
       AND u.role = 'student'
     ORDER BY ps.is_primary DESC, u.name ASC`,
    [parentId, schoolId],
  );
}

export async function findLinkedChild(
  parentId: number,
  schoolId: number,
  studentId: number,
) {
  return pool.query(
    `SELECT
       u.id AS student_id,
       u.name AS student_name,
       u.avatar,
       ps.relation,
       ps.is_primary,
       sp.status,
       sp.academic_year,
       sp.grade_id,
       sp.classroom_id,
       sp.seat_number,
       g.name AS grade_name,
       c.name AS classroom_name
     FROM parent_students ps
     JOIN users u ON u.id = ps.student_id
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN grades g ON g.id = sp.grade_id
     LEFT JOIN classrooms c ON c.id = sp.classroom_id
     WHERE ps.parent_id = $1
       AND ps.student_id = $2
       AND u.school_id = $3
       AND u.deleted_at IS NULL
       AND u.role = 'student'
     LIMIT 1`,
    [parentId, studentId, schoolId],
  );
}

export async function findSchool(schoolId: number) {
  return pool.query(
    `SELECT id, name, login_code, logo
     FROM schools
     WHERE id = $1 AND deleted_at IS NULL`,
    [schoolId],
  );
}

export async function queryChildDashboardStats(
  studentId: number,
  schoolId: number,
  classroomId: number | null,
  dateFrom: string,
  dateTo: string,
) {
  return Promise.all([
    pool.query(
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
      [schoolId, studentId, dateFrom, dateTo],
    ),
    classroomId
      ? pool.query(
          `SELECT
             COALESCE(AVG(
               CASE WHEN a.max_score > 0
                 THEN (a.score::float / a.max_score::float) * 100
                 ELSE NULL END
             ), 0) AS avg_pct,
             COUNT(*)::int AS attempts_count
           FROM student_exam_attempts a
           JOIN teacher_exams e ON e.id = a.exam_id
           WHERE a.student_id = $1
             AND a.submitted_at IS NOT NULL
             AND e.classroom_id = $2
             AND e.deleted_at IS NULL`,
          [studentId, classroomId],
        )
      : Promise.resolve({ rows: [{ avg_pct: 0, attempts_count: 0 }] }),
    classroomId
      ? pool.query(
          `SELECT COUNT(*)::int AS c
           FROM teacher_task_grades tg
           JOIN teacher_tasks t ON t.id = tg.task_id
           WHERE tg.student_id = $1
             AND t.classroom_id = $2
             AND t.deleted_at IS NULL
             AND tg.grade IS NOT NULL`,
          [studentId, classroomId],
        )
      : Promise.resolve({ rows: [{ c: 0 }] }),
    pool.query(
      `SELECT COUNT(*)::int AS c
       FROM teacher_student_opinions o
       WHERE o.student_id = $1
         AND o.school_id = $2
         AND o.deleted_at IS NULL`,
      [studentId, schoolId],
    ),
  ]);
}

export async function listAttendanceRecords(
  studentId: number,
  schoolId: number,
  dateFrom: string,
  dateTo: string,
  limit = 60,
) {
  return pool.query(
    `SELECT
       a.id,
       a.attendance_date::text AS attendance_date,
       a.status,
       a.check_in_time,
       a.check_in_method,
       a.notes
     FROM attendance_records a
     WHERE a.school_id = $1
       AND a.student_id = $2
       AND a.cancelled_at IS NULL
       AND a.attendance_date BETWEEN $3::date AND $4::date
     ORDER BY a.attendance_date DESC
     LIMIT $5`,
    [schoolId, studentId, dateFrom, dateTo, Math.min(Math.max(limit, 1), 200)],
  );
}

export async function listExamResults(studentId: number, classroomId: number) {
  return pool.query(
    `SELECT
       a.id,
       a.exam_id,
       e.title AS exam_title,
       e.subject_id,
       s.name AS subject_name,
       u.name AS teacher_name,
       a.score,
       a.max_score,
       a.submitted_at
     FROM student_exam_attempts a
     JOIN teacher_exams e ON e.id = a.exam_id
     JOIN subjects s ON s.id = e.subject_id
     JOIN users u ON u.id = e.teacher_id
     WHERE a.student_id = $1
       AND a.submitted_at IS NOT NULL
       AND e.classroom_id = $2
       AND e.deleted_at IS NULL
     ORDER BY a.submitted_at DESC`,
    [studentId, classroomId],
  );
}

export async function listTaskGrades(studentId: number, classroomId: number) {
  return pool.query(
    `SELECT
       tg.id,
       tg.task_id,
       t.title AS task_title,
       t.max_grade,
       t.subject_id,
       s.name AS subject_name,
       u.name AS teacher_name,
       tg.grade,
       tg.review,
       tg.submitted_at,
       tg.graded_at
     FROM teacher_task_grades tg
     JOIN teacher_tasks t ON t.id = tg.task_id
     JOIN subjects s ON s.id = t.subject_id
     JOIN users u ON u.id = t.teacher_id
     WHERE tg.student_id = $1
       AND t.classroom_id = $2
       AND t.deleted_at IS NULL
       AND tg.grade IS NOT NULL
     ORDER BY tg.graded_at DESC NULLS LAST, tg.submitted_at DESC NULLS LAST`,
    [studentId, classroomId],
  );
}

export async function listTeacherOpinions(studentId: number, schoolId: number) {
  return pool.query(
    `SELECT
       o.id,
       o.title,
       o.body AS review,
       o.subject_id,
       s.name AS subject_name,
       o.teacher_id,
       u.name AS teacher_name,
       o.created_at AS graded_at,
       NULL::int AS task_id,
       NULL::text AS task_title,
       NULL::numeric AS grade,
       NULL::numeric AS max_grade
     FROM teacher_student_opinions o
     JOIN users u ON u.id = o.teacher_id
     LEFT JOIN subjects s ON s.id = o.subject_id
     WHERE o.student_id = $1
       AND o.school_id = $2
       AND o.deleted_at IS NULL
     ORDER BY o.created_at DESC, o.id DESC`,
    [studentId, schoolId],
  );
}

/** One row per subject taught in the classroom (material = subject + teacher). */
export async function listMaterials(classroomId: number, schoolId: number) {
  return pool.query(
    `SELECT
       s.id AS subject_id,
       s.name AS subject_name,
       u.id AS teacher_id,
       u.name AS teacher_name,
       COUNT(DISTINCT l.id)::int AS lessons_count,
       COALESCE(SUM(
         (SELECT COUNT(*)::int FROM teacher_lesson_attachments att WHERE att.lesson_id = l.id)
       ), 0)::int AS attachments_count,
       MAX(l.created_at) AS last_published_at
     FROM teacher_lessons l
     JOIN subjects s ON s.id = l.subject_id
     JOIN users u ON u.id = l.teacher_id
     WHERE l.classroom_id = $1
       AND l.school_id = $2
       AND l.deleted_at IS NULL
     GROUP BY s.id, s.name, u.id, u.name
     ORDER BY s.name ASC, u.name ASC`,
    [classroomId, schoolId],
  );
}

export async function listSubjectLessonsWithAttachments(
  classroomId: number,
  schoolId: number,
  subjectId: number,
) {
  const lessons = await pool.query(
    `SELECT
       l.id,
       l.title,
       l.description,
       l.subject_id,
       s.name AS subject_name,
       u.id AS teacher_id,
       u.name AS teacher_name,
       l.created_at
     FROM teacher_lessons l
     JOIN subjects s ON s.id = l.subject_id
     JOIN users u ON u.id = l.teacher_id
     WHERE l.classroom_id = $1
       AND l.school_id = $2
       AND l.subject_id = $3
       AND l.deleted_at IS NULL
     ORDER BY l.created_at DESC`,
    [classroomId, schoolId, subjectId],
  );

  if (!lessons.rowCount) {
    return { subject: null as Record<string, unknown> | null, lessons: [] as Array<Record<string, unknown>> };
  }

  const lessonIds = lessons.rows.map((r) => r.id as number);
  const attachments = await pool.query(
    `SELECT id, lesson_id, kind, title, file_url, filename, created_at
     FROM teacher_lesson_attachments
     WHERE lesson_id = ANY($1::int[])
     ORDER BY lesson_id ASC, id ASC`,
    [lessonIds],
  );

  const byLesson = new Map<number, Array<Record<string, unknown>>>();
  for (const a of attachments.rows) {
    const list = byLesson.get(a.lesson_id) || [];
    list.push(a);
    byLesson.set(a.lesson_id, list);
  }

  const first = lessons.rows[0];
  return {
    subject: {
      subject_id: first.subject_id,
      subject_name: first.subject_name,
      teacher_id: first.teacher_id,
      teacher_name: first.teacher_name,
    },
    lessons: lessons.rows.map((l) => ({
      ...l,
      attachments: byLesson.get(l.id) || [],
    })),
  };
}

export async function listLessons(classroomId: number, schoolId: number, subjectId?: number) {
  const values: unknown[] = [classroomId, schoolId];
  let subjectFilter = '';
  if (subjectId != null && !Number.isNaN(subjectId)) {
    values.push(subjectId);
    subjectFilter = `AND l.subject_id = $${values.length}`;
  }
  return pool.query(
    `SELECT
       l.id,
       l.title,
       l.description,
       l.subject_id,
       s.name AS subject_name,
       u.name AS teacher_name,
       l.created_at,
       (
         SELECT COUNT(*)::int FROM teacher_lesson_attachments att
         WHERE att.lesson_id = l.id
       ) AS attachments_count
     FROM teacher_lessons l
     JOIN subjects s ON s.id = l.subject_id
     JOIN users u ON u.id = l.teacher_id
     WHERE l.classroom_id = $1
       AND l.school_id = $2
       AND l.deleted_at IS NULL
       ${subjectFilter}
     ORDER BY l.created_at DESC
     LIMIT 100`,
    values,
  );
}

export async function findOwnedLesson(
  classroomId: number,
  schoolId: number,
  lessonId: number,
) {
  return pool.query(
    `SELECT
       l.*,
       s.name AS subject_name,
       u.name AS teacher_name
     FROM teacher_lessons l
     JOIN subjects s ON s.id = l.subject_id
     JOIN users u ON u.id = l.teacher_id
     WHERE l.id = $1
       AND l.classroom_id = $2
       AND l.school_id = $3
       AND l.deleted_at IS NULL`,
    [lessonId, classroomId, schoolId],
  );
}

export async function listLessonAttachments(lessonId: number) {
  return pool.query(
    `SELECT id, kind, title, file_url, filename, created_at
     FROM teacher_lesson_attachments
     WHERE lesson_id = $1
     ORDER BY id ASC`,
    [lessonId],
  );
}
