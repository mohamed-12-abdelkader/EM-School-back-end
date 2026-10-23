import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import type { User } from '../db/types';
import { SubmitExamSchema, SubmitTaskSchema } from './studentPortal.modules';

export const router = Router();

const SUBJECT_COLORS = [
  '#4F46E5',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
];

const SUBJECT_ICONS = [
  'BookOpen',
  'Calculator',
  'FlaskConical',
  'Globe2',
  'Languages',
  'Atom',
  'PenLine',
  'Music',
];

type StudentCtx = {
  studentId: number;
  schoolId: number;
  classroomId: number;
  gradeId: number | null;
  academicYear: string | null;
  gradeName: string | null;
  classroomName: string | null;
};

async function requireStudentCtx(user: User | undefined): Promise<StudentCtx> {
  if (!user?.school_id) throw new HttpError(403, 'Student is not linked to a school');
  const profile = await pool.query(
    `SELECT sp.classroom_id, sp.grade_id, sp.academic_year, sp.status,
            g.name AS grade_name, c.name AS classroom_name
     FROM student_profiles sp
     LEFT JOIN grades g ON g.id = sp.grade_id
     LEFT JOIN classrooms c ON c.id = sp.classroom_id
     WHERE sp.user_id = $1`,
    [user.id],
  );
  if (!profile.rowCount || profile.rows[0].status !== 'active') {
    throw new HttpError(403, 'Student account is not active');
  }
  if (!profile.rows[0].classroom_id) {
    throw new HttpError(400, 'Student is not assigned to a classroom');
  }
  return {
    studentId: user.id,
    schoolId: user.school_id,
    classroomId: profile.rows[0].classroom_id,
    gradeId: profile.rows[0].grade_id,
    academicYear: profile.rows[0].academic_year,
    gradeName: profile.rows[0].grade_name,
    classroomName: profile.rows[0].classroom_name,
  };
}

function subjectStyle(subjectId: number) {
  const i = Math.abs(subjectId) % SUBJECT_COLORS.length;
  return { color: SUBJECT_COLORS[i], icon: SUBJECT_ICONS[i] };
}

async function assertStudentOwnsExam(ctx: StudentCtx, examId: number) {
  const exam = await pool.query(
    `SELECT e.*, s.name AS subject_name, u.name AS teacher_name
     FROM teacher_exams e
     JOIN subjects s ON s.id = e.subject_id
     JOIN users u ON u.id = e.teacher_id
     WHERE e.id = $1
       AND e.classroom_id = $2
       AND e.school_id = $3
       AND e.deleted_at IS NULL
       AND e.status IN ('published', 'closed')`,
    [examId, ctx.classroomId, ctx.schoolId],
  );
  if (!exam.rowCount) throw new HttpError(404, 'Exam not found');
  return exam.rows[0];
}

async function assertStudentOwnsTask(ctx: StudentCtx, taskId: number) {
  const task = await pool.query(
    `SELECT t.*, s.name AS subject_name, u.name AS teacher_name
     FROM teacher_tasks t
     JOIN subjects s ON s.id = t.subject_id
     JOIN users u ON u.id = t.teacher_id
     WHERE t.id = $1
       AND t.classroom_id = $2
       AND t.school_id = $3
       AND t.deleted_at IS NULL`,
    [taskId, ctx.classroomId, ctx.schoolId],
  );
  if (!task.rowCount) throw new HttpError(404, 'Task not found');
  return task.rows[0];
}

async function assertStudentOwnsLesson(ctx: StudentCtx, lessonId: number) {
  const lesson = await pool.query(
    `SELECT l.*, s.name AS subject_name, u.name AS teacher_name
     FROM teacher_lessons l
     JOIN subjects s ON s.id = l.subject_id
     JOIN users u ON u.id = l.teacher_id
     WHERE l.id = $1
       AND l.classroom_id = $2
       AND l.school_id = $3
       AND l.deleted_at IS NULL`,
    [lessonId, ctx.classroomId, ctx.schoolId],
  );
  if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');
  return lesson.rows[0];
}

function mapTaskStatus(row: {
  submitted_at: string | null;
  grade: number | null;
  due_at: string | null;
}): 'new' | 'submitted' | 'graded' | 'overdue' {
  if (row.grade != null) return 'graded';
  if (row.submitted_at) return 'submitted';
  if (row.due_at && new Date(row.due_at).getTime() < Date.now()) return 'overdue';
  return 'new';
}

/** Dashboard */
router.get(
  '/portal/dashboard',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const todayDow = new Date().getDay(); // 0=Sunday
    const [subjects, lessons, tasks, exams, notifs, attempts, todaySlots] =
      await Promise.all([
      pool.query(
        `SELECT DISTINCT s.id, s.name
         FROM subjects s
         WHERE s.school_id = $1 AND s.deleted_at IS NULL
           AND (
             EXISTS (
               SELECT 1 FROM timetable_slots ts
               JOIN timetables t ON t.id = ts.timetable_id
               WHERE t.classroom_id = $2 AND t.school_id = $1
                 AND t.status = 'published' AND t.deleted_at IS NULL
                 AND ts.subject_id = s.id
             )
             OR EXISTS (
               SELECT 1 FROM teacher_lessons l
               WHERE l.classroom_id = $2 AND l.school_id = $1
                 AND l.subject_id = s.id AND l.deleted_at IS NULL
             )
             OR EXISTS (
               SELECT 1 FROM teacher_exams e
               WHERE e.classroom_id = $2 AND e.school_id = $1
                 AND e.subject_id = s.id AND e.deleted_at IS NULL
                 AND e.status IN ('published', 'closed')
             )
             OR EXISTS (
               SELECT 1 FROM teacher_tasks tk
               WHERE tk.classroom_id = $2 AND tk.school_id = $1
                 AND tk.subject_id = s.id AND tk.deleted_at IS NULL
             )
           )
         ORDER BY s.name`,
        [ctx.schoolId, ctx.classroomId],
      ),
      pool.query(
        `SELECT l.id, l.title, l.subject_id, l.created_at, s.name AS subject_name
         FROM teacher_lessons l
         JOIN subjects s ON s.id = l.subject_id
         WHERE l.classroom_id = $1 AND l.school_id = $2 AND l.deleted_at IS NULL
         ORDER BY l.created_at DESC LIMIT 5`,
        [ctx.classroomId, ctx.schoolId],
      ),
      pool.query(
        `SELECT t.id, t.title, t.due_at, t.max_grade, t.subject_id, t.teacher_id,
                s.name AS subject_name, u.name AS teacher_name,
                tg.grade, tg.submitted_at
         FROM teacher_tasks t
         JOIN subjects s ON s.id = t.subject_id
         JOIN users u ON u.id = t.teacher_id
         LEFT JOIN teacher_task_grades tg
           ON tg.task_id = t.id AND tg.student_id = $3
         WHERE t.classroom_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
         ORDER BY t.due_at NULLS LAST, t.created_at DESC
         LIMIT 8`,
        [ctx.classroomId, ctx.schoolId, ctx.studentId],
      ),
      pool.query(
        `SELECT e.id, e.title, e.duration_minutes, e.total_points, e.subject_id,
                e.created_at, s.name AS subject_name, u.name AS teacher_name,
                a.id AS attempt_id, a.score, a.max_score AS attempt_max
         FROM teacher_exams e
         JOIN subjects s ON s.id = e.subject_id
         JOIN users u ON u.id = e.teacher_id
         LEFT JOIN student_exam_attempts a
           ON a.exam_id = e.id AND a.student_id = $3
         WHERE e.classroom_id = $1 AND e.school_id = $2
           AND e.deleted_at IS NULL AND e.status IN ('published', 'closed')
         ORDER BY e.created_at DESC
         LIMIT 8`,
        [ctx.classroomId, ctx.schoolId, ctx.studentId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM student_notifications
         WHERE student_id = $1 AND read_at IS NULL`,
        [ctx.studentId],
      ),
      pool.query(
        `SELECT COALESCE(AVG(CASE WHEN max_score > 0 THEN (score / max_score) * 100 END), 0) AS avg_pct,
                COUNT(*)::int AS attempts_count
         FROM student_exam_attempts WHERE student_id = $1`,
        [ctx.studentId],
      ),
      pool.query(
        `SELECT
           ts.id,
           ts.day_of_week,
           ts.period_number,
           to_char(ts.start_time, 'HH24:MI') AS start_time,
           to_char(ts.end_time, 'HH24:MI') AS end_time,
           ts.slot_type,
           ts.subject_id,
           sub.name AS subject_name,
           ts.teacher_id,
           u.name AS teacher_name,
           ts.notes,
           c.name AS classroom_name
         FROM timetable_slots ts
         JOIN timetables t ON t.id = ts.timetable_id
         JOIN classrooms c ON c.id = t.classroom_id
         LEFT JOIN subjects sub ON sub.id = ts.subject_id
         LEFT JOIN users u ON u.id = ts.teacher_id
         WHERE t.classroom_id = $1 AND t.school_id = $2
           AND t.status = 'published' AND t.deleted_at IS NULL
           AND ts.day_of_week = $3
         ORDER BY ts.period_number ASC, ts.start_time ASC`,
        [ctx.classroomId, ctx.schoolId, todayDow],
      ),
    ]);

    const pendingTasks = tasks.rows.filter(
      (t) => !t.submitted_at && t.grade == null,
    ).length;
    const pendingExams = exams.rows.filter((e) => !e.attempt_id).length;

    res.json({
      profile: {
        academic_year: ctx.academicYear,
        grade_name: ctx.gradeName,
        classroom_name: ctx.classroomName,
      },
      stats: {
        subjects_count: subjects.rows.length,
        pending_tasks: pendingTasks,
        pending_exams: pendingExams,
        unread_notifications: notifs.rows[0].c,
        avg_exam_percent: Math.round(Number(attempts.rows[0].avg_pct) || 0),
        exam_attempts: attempts.rows[0].attempts_count,
      },
      subjects: subjects.rows.map((s) => ({
        id: String(s.id),
        name: s.name,
        ...subjectStyle(s.id),
      })),
      recent_lessons: lessons.rows.map((l) => ({
        id: String(l.id),
        title: l.title,
        subjectId: String(l.subject_id),
        subjectName: l.subject_name,
        date: l.created_at,
      })),
      upcoming_tasks: tasks.rows.map((t) => ({
        id: String(t.id),
        title: t.title,
        subjectId: String(t.subject_id),
        subjectName: t.subject_name,
        teacherName: t.teacher_name,
        teacherId: String(t.teacher_id ?? ''),
        dueAt: t.due_at,
        maxScore: Number(t.max_grade),
        score: t.grade != null ? Number(t.grade) : null,
        status: mapTaskStatus(t),
      })),
      today_slots: todaySlots.rows.map((row) => {
        const style = row.subject_id
          ? subjectStyle(Number(row.subject_id))
          : { color: '#64748B', icon: 'Calendar' };
        return {
          id: String(row.id),
          day: row.day_of_week,
          periodNumber: row.period_number,
          start: row.start_time,
          end: row.end_time,
          slotType: row.slot_type,
          subjectId: row.subject_id != null ? String(row.subject_id) : '',
          subjectName: row.subject_name || null,
          teacherId: row.teacher_id != null ? String(row.teacher_id) : '',
          teacherName: row.teacher_name || null,
          room: row.notes || row.classroom_name || null,
          color: style.color,
        };
      }),
      exams: exams.rows.map((e) => ({
        id: String(e.id),
        title: e.title,
        subjectId: String(e.subject_id),
        teacherName: e.teacher_name,
        subjectName: e.subject_name,
        durationMin: e.duration_minutes,
        totalPoints: Number(e.total_points),
        attempted: !!e.attempt_id,
        score: e.score != null ? Number(e.score) : null,
        maxScore: e.attempt_max != null ? Number(e.attempt_max) : Number(e.total_points),
        date: e.created_at,
      })),
    });
  }),
);

/** Subjects list */
router.get(
  '/portal/subjects',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const result = await pool.query(
      `SELECT s.id, s.name, s.description,
         (
           SELECT u.id FROM timetable_slots ts
           JOIN timetables t ON t.id = ts.timetable_id
           JOIN users u ON u.id = ts.teacher_id
           WHERE t.classroom_id = $2 AND t.school_id = $1
             AND t.status = 'published' AND t.deleted_at IS NULL
             AND ts.subject_id = s.id
           LIMIT 1
         ) AS teacher_id,
         (
           SELECT u.name FROM timetable_slots ts
           JOIN timetables t ON t.id = ts.timetable_id
           JOIN users u ON u.id = ts.teacher_id
           WHERE t.classroom_id = $2 AND t.school_id = $1
             AND t.status = 'published' AND t.deleted_at IS NULL
             AND ts.subject_id = s.id
           LIMIT 1
         ) AS teacher_name,
         (SELECT COUNT(*)::int FROM teacher_lessons l
           WHERE l.classroom_id = $2 AND l.school_id = $1
             AND l.subject_id = s.id AND l.deleted_at IS NULL) AS lessons_count,
         (SELECT COUNT(*)::int FROM teacher_tasks tk
           WHERE tk.classroom_id = $2 AND tk.school_id = $1
             AND tk.subject_id = s.id AND tk.deleted_at IS NULL) AS tasks_count,
         (SELECT COUNT(*)::int FROM teacher_exams e
           WHERE e.classroom_id = $2 AND e.school_id = $1
             AND e.subject_id = s.id AND e.deleted_at IS NULL
             AND e.status IN ('published', 'closed')) AS exams_count,
         (
           SELECT a.score FROM student_exam_attempts a
           JOIN teacher_exams e ON e.id = a.exam_id
           WHERE a.student_id = $3 AND e.subject_id = s.id
             AND e.classroom_id = $2 AND e.deleted_at IS NULL
           ORDER BY a.submitted_at DESC LIMIT 1
         ) AS last_exam_score,
         (
           SELECT a.max_score FROM student_exam_attempts a
           JOIN teacher_exams e ON e.id = a.exam_id
           WHERE a.student_id = $3 AND e.subject_id = s.id
             AND e.classroom_id = $2 AND e.deleted_at IS NULL
           ORDER BY a.submitted_at DESC LIMIT 1
         ) AS last_exam_max
       FROM subjects s
       WHERE s.school_id = $1 AND s.deleted_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM timetable_slots ts
             JOIN timetables t ON t.id = ts.timetable_id
             WHERE t.classroom_id = $2 AND t.school_id = $1
               AND t.status = 'published' AND t.deleted_at IS NULL
               AND ts.subject_id = s.id
           )
           OR EXISTS (
             SELECT 1 FROM teacher_lessons l
             WHERE l.classroom_id = $2 AND l.school_id = $1
               AND l.subject_id = s.id AND l.deleted_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM teacher_exams e
             WHERE e.classroom_id = $2 AND e.school_id = $1
               AND e.subject_id = s.id AND e.deleted_at IS NULL
               AND e.status IN ('published', 'closed')
           )
           OR EXISTS (
             SELECT 1 FROM teacher_tasks tk
             WHERE tk.classroom_id = $2 AND tk.school_id = $1
               AND tk.subject_id = s.id AND tk.deleted_at IS NULL
           )
         )
       ORDER BY s.name`,
      [ctx.schoolId, ctx.classroomId, ctx.studentId],
    );

    res.json({
      subjects: result.rows.map((s) => {
        const style = subjectStyle(s.id);
        const done =
          Number(s.lessons_count) + Number(s.tasks_count) + Number(s.exams_count);
        const gradedHint =
          s.last_exam_score != null && s.last_exam_max
            ? Math.round((Number(s.last_exam_score) / Number(s.last_exam_max)) * 100)
            : 0;
        return {
          id: String(s.id),
          name: s.name,
          description: s.description || '',
          icon: style.icon,
          color: style.color,
          teacherId: s.teacher_id != null ? String(s.teacher_id) : '',
          teacherName: s.teacher_name || '',
          progress: Math.min(100, gradedHint || (done > 0 ? 20 : 0)),
          lecturesCount: Number(s.lessons_count),
          assignmentsCount: Number(s.tasks_count),
          examsCount: Number(s.exams_count),
          lastExamScore:
            s.last_exam_score != null ? Number(s.last_exam_score) : null,
          lastExamMax: s.last_exam_max != null ? Number(s.last_exam_max) : null,
        };
      }),
    });
  }),
);

/** Subject detail: lessons, tasks, exams, materials */
router.get(
  '/portal/subjects/:id',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) throw new HttpError(400, 'Invalid subject id');

    const subject = await pool.query(
      `SELECT id, name, description FROM subjects
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [subjectId, ctx.schoolId],
    );
    if (!subject.rowCount) throw new HttpError(404, 'Subject not found');

    const [teacher, lessons, tasks, exams] = await Promise.all([
      pool.query(
        `SELECT u.id, u.name, u.avatar
         FROM timetable_slots ts
         JOIN timetables t ON t.id = ts.timetable_id
         JOIN users u ON u.id = ts.teacher_id
         WHERE t.classroom_id = $1 AND t.school_id = $2
           AND t.status = 'published' AND t.deleted_at IS NULL
           AND ts.subject_id = $3
         LIMIT 1`,
        [ctx.classroomId, ctx.schoolId, subjectId],
      ),
      pool.query(
        `SELECT l.*,
           (SELECT COUNT(*)::int FROM teacher_lesson_attachments a WHERE a.lesson_id = l.id) AS attachments_count
         FROM teacher_lessons l
         WHERE l.classroom_id = $1 AND l.school_id = $2
           AND l.subject_id = $3 AND l.deleted_at IS NULL
         ORDER BY l.created_at DESC`,
        [ctx.classroomId, ctx.schoolId, subjectId],
      ),
      pool.query(
        `SELECT t.*,
           tg.grade, tg.review, tg.submitted_at, tg.graded_at,
           (SELECT COUNT(*)::int FROM teacher_task_questions q WHERE q.task_id = t.id) AS questions_count
         FROM teacher_tasks t
         LEFT JOIN teacher_task_grades tg
           ON tg.task_id = t.id AND tg.student_id = $4
         WHERE t.classroom_id = $1 AND t.school_id = $2
           AND t.subject_id = $3 AND t.deleted_at IS NULL
         ORDER BY t.due_at NULLS LAST, t.created_at DESC`,
        [ctx.classroomId, ctx.schoolId, subjectId, ctx.studentId],
      ),
      pool.query(
        `SELECT e.*,
           (SELECT COUNT(*)::int FROM teacher_exam_questions q WHERE q.exam_id = e.id) AS questions_count,
           a.id AS attempt_id, a.score, a.max_score AS attempt_max, a.submitted_at AS attempt_at
         FROM teacher_exams e
         LEFT JOIN student_exam_attempts a
           ON a.exam_id = e.id AND a.student_id = $4
         WHERE e.classroom_id = $1 AND e.school_id = $2
           AND e.subject_id = $3 AND e.deleted_at IS NULL
           AND e.status IN ('published', 'closed')
         ORDER BY e.created_at DESC`,
        [ctx.classroomId, ctx.schoolId, subjectId, ctx.studentId],
      ),
    ]);

    const style = subjectStyle(subjectId);
    const teacherRow = teacher.rows[0];

    res.json({
      subject: {
        id: String(subject.rows[0].id),
        name: subject.rows[0].name,
        description: subject.rows[0].description || '',
        icon: style.icon,
        color: style.color,
        teacherId: teacherRow ? String(teacherRow.id) : '',
        progress: 0,
        lecturesCount: lessons.rows.length,
        assignmentsCount: tasks.rows.length,
      },
      teacher: teacherRow
        ? {
            id: String(teacherRow.id),
            name: teacherRow.name,
            avatarColor: style.color,
            subjectIds: [String(subjectId)],
          }
        : null,
      lectures: lessons.rows.map((l) => ({
        id: String(l.id),
        subjectId: String(subjectId),
        teacherId: teacherRow ? String(teacherRow.id) : String(l.teacher_id),
        title: l.title,
        durationMin: 0,
        date: l.created_at,
        type: 'recorded' as const,
        status: 'recorded' as const,
        watchProgress: 0,
        summary: l.description || '',
        completed: false,
        attachmentsCount: Number(l.attachments_count),
      })),
      assignments: tasks.rows.map((t) => ({
        id: String(t.id),
        subjectId: String(subjectId),
        teacherId: String(t.teacher_id),
        title: t.title,
        dueAt: t.due_at,
        status: mapTaskStatus(t),
        tasksCount: Number(t.questions_count),
        score: t.grade != null ? Number(t.grade) : null,
        maxScore: Number(t.max_grade),
        description: t.description || '',
        review: t.review || null,
      })),
      exams: exams.rows.map((e) => ({
        id: String(e.id),
        subjectId: String(subjectId),
        title: e.title,
        durationMin: e.duration_minutes || 0,
        questionIds: Array.from({ length: Number(e.questions_count) }, (_, i) =>
          String(i),
        ),
        difficulty: 'medium' as const,
        isOfficial: true,
        date: e.created_at,
        totalPoints: Number(e.total_points),
        attempted: !!e.attempt_id,
        score: e.score != null ? Number(e.score) : null,
        maxScore: e.attempt_max != null ? Number(e.attempt_max) : Number(e.total_points),
      })),
      announcements: [],
    });
  }),
);

/** Lessons list */
router.get(
  '/portal/lessons',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const subjectId = req.query.subject_id ? Number(req.query.subject_id) : null;
    const values: unknown[] = [ctx.classroomId, ctx.schoolId];
    let filter = '';
    if (subjectId) {
      values.push(subjectId);
      filter = ` AND l.subject_id = $${values.length}`;
    }
    const result = await pool.query(
      `SELECT l.*, s.name AS subject_name, u.name AS teacher_name,
         (SELECT COUNT(*)::int FROM teacher_lesson_attachments a WHERE a.lesson_id = l.id) AS attachments_count,
         (SELECT COUNT(*)::int FROM teacher_lesson_attachments a
           WHERE a.lesson_id = l.id AND a.kind = 'video') AS videos_count,
         (SELECT COUNT(*)::int FROM teacher_lesson_attachments a
           WHERE a.lesson_id = l.id AND a.kind = 'pdf') AS pdfs_count
       FROM teacher_lessons l
       JOIN subjects s ON s.id = l.subject_id
       JOIN users u ON u.id = l.teacher_id
       WHERE l.classroom_id = $1 AND l.school_id = $2 AND l.deleted_at IS NULL${filter}
       ORDER BY l.created_at DESC`,
      values,
    );
    res.json({
      lessons: result.rows.map((l) => ({
        id: String(l.id),
        subjectId: String(l.subject_id),
        subjectName: l.subject_name,
        teacherId: String(l.teacher_id),
        teacherName: l.teacher_name,
        title: l.title,
        description: l.description || '',
        date: l.created_at,
        attachmentsCount: Number(l.attachments_count),
        videosCount: Number(l.videos_count),
        pdfsCount: Number(l.pdfs_count),
        type: 'recorded',
        status: 'recorded',
        durationMin: 0,
        watchProgress: 0,
        completed: false,
        summary: l.description || '',
      })),
    });
  }),
);

/** Lesson detail + attachments (videos / PDFs) */
router.get(
  '/portal/lessons/:id',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const lesson = await assertStudentOwnsLesson(ctx, Number(req.params.id));
    const attachments = await pool.query(
      `SELECT id, kind, title, file_url, filename, created_at
       FROM teacher_lesson_attachments
       WHERE lesson_id = $1
       ORDER BY created_at ASC`,
      [lesson.id],
    );
    res.json({
      lesson: {
        id: String(lesson.id),
        subjectId: String(lesson.subject_id),
        subjectName: lesson.subject_name,
        teacherId: String(lesson.teacher_id),
        teacherName: lesson.teacher_name,
        title: lesson.title,
        description: lesson.description || '',
        date: lesson.created_at,
        type: 'recorded',
        status: 'recorded',
        durationMin: 0,
        watchProgress: 0,
        completed: false,
        summary: lesson.description || '',
      },
      attachments: attachments.rows.map((a) => ({
        id: String(a.id),
        kind: a.kind as 'video' | 'pdf',
        title: a.title,
        fileUrl: a.file_url,
        filename: a.filename,
      })),
    });
  }),
);

/** Tasks list */
router.get(
  '/portal/tasks',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const subjectId = req.query.subject_id ? Number(req.query.subject_id) : null;
    const values: unknown[] = [ctx.classroomId, ctx.schoolId, ctx.studentId];
    let filter = '';
    if (subjectId) {
      values.push(subjectId);
      filter = ` AND t.subject_id = $${values.length}`;
    }
    const result = await pool.query(
      `SELECT t.*, s.name AS subject_name, u.name AS teacher_name,
         tg.grade, tg.review, tg.submitted_at, tg.graded_at,
         (SELECT COUNT(*)::int FROM teacher_task_questions q WHERE q.task_id = t.id) AS questions_count,
         (SELECT COUNT(*)::int FROM teacher_task_attachments a WHERE a.task_id = t.id) AS attachments_count
       FROM teacher_tasks t
       JOIN subjects s ON s.id = t.subject_id
       JOIN users u ON u.id = t.teacher_id
       LEFT JOIN teacher_task_grades tg
         ON tg.task_id = t.id AND tg.student_id = $3
       WHERE t.classroom_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL${filter}
       ORDER BY t.due_at NULLS LAST, t.created_at DESC`,
      values,
    );
    res.json({
      tasks: result.rows.map((t) => ({
        id: String(t.id),
        subjectId: String(t.subject_id),
        subjectName: t.subject_name,
        teacherId: String(t.teacher_id),
        teacherName: t.teacher_name,
        title: t.title,
        dueAt: t.due_at,
        status: mapTaskStatus(t),
        tasksCount: Number(t.questions_count),
        attachmentsCount: Number(t.attachments_count),
        score: t.grade != null ? Number(t.grade) : null,
        maxScore: Number(t.max_grade),
        description: t.description || '',
        review: t.review || null,
      })),
    });
  }),
);

/** Task detail */
router.get(
  '/portal/tasks/:id',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const task = await assertStudentOwnsTask(ctx, Number(req.params.id));

    const [grade, attachments, questions, choices, answers] = await Promise.all([
      pool.query(
        `SELECT * FROM teacher_task_grades WHERE task_id = $1 AND student_id = $2`,
        [task.id, ctx.studentId],
      ),
      pool.query(
        `SELECT * FROM teacher_task_attachments WHERE task_id = $1 ORDER BY created_at`,
        [task.id],
      ),
      pool.query(
        `SELECT * FROM teacher_task_questions WHERE task_id = $1 ORDER BY position, id`,
        [task.id],
      ),
      pool.query(
        `SELECT c.* FROM teacher_task_choices c
         JOIN teacher_task_questions q ON q.id = c.question_id
         WHERE q.task_id = $1
         ORDER BY c.position, c.id`,
        [task.id],
      ),
      pool.query(
        `SELECT * FROM student_task_answers WHERE task_id = $1 AND student_id = $2`,
        [task.id, ctx.studentId],
      ),
    ]);

    const gradeRow = grade.rows[0] || null;
    const submitted = !!gradeRow?.submitted_at || gradeRow?.grade != null;
    const byQ = new Map<number, typeof choices.rows>();
    for (const ch of choices.rows) {
      const list = byQ.get(ch.question_id) || [];
      list.push(ch);
      byQ.set(ch.question_id, list);
    }
    const ansByQ = new Map(answers.rows.map((a) => [a.question_id, a]));

    res.json({
      task: {
        id: String(task.id),
        subjectId: String(task.subject_id),
        subjectName: task.subject_name,
        teacherId: String(task.teacher_id),
        teacherName: task.teacher_name,
        title: task.title,
        description: task.description || '',
        dueAt: task.due_at,
        maxScore: Number(task.max_grade),
        status: mapTaskStatus({
          submitted_at: gradeRow?.submitted_at ?? null,
          grade: gradeRow?.grade ?? null,
          due_at: task.due_at,
        }),
        score: gradeRow?.grade != null ? Number(gradeRow.grade) : null,
        review: gradeRow?.review || null,
        submittedAt: gradeRow?.submitted_at || null,
        submissionNote: gradeRow?.submission_note || null,
      },
      attachments: attachments.rows.map((a) => ({
        id: String(a.id),
        kind: a.kind,
        title: a.title,
        fileUrl: a.file_url,
        filename: a.filename,
      })),
      questions: questions.rows.map((q) => {
        const qChoices = byQ.get(q.id) || [];
        const ans = ansByQ.get(q.id);
        return {
          id: String(q.id),
          type: q.type as 'mcq' | 'written',
          text: q.text,
          points: Number(q.points),
          choices: qChoices.map((c) => ({
            id: String(c.id),
            text: c.text,
            ...(submitted
              ? { isCorrect: !!c.is_correct }
              : {}),
          })),
          ...(submitted
            ? {
                modelAnswer: q.model_answer,
                yourChoiceId: ans?.choice_id != null ? String(ans.choice_id) : null,
                yourWritten: ans?.written_answer ?? null,
                isCorrect: ans?.is_correct ?? null,
                pointsAwarded: ans ? Number(ans.points_awarded) : 0,
              }
            : {}),
        };
      }),
    });
  }),
);

/** Submit task */
router.post(
  '/portal/tasks/:id/submit',
  authMiddleware(['student']),
  validate(SubmitTaskSchema),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const task = await assertStudentOwnsTask(ctx, Number(req.params.id));
    const body = req.body as z.infer<typeof SubmitTaskSchema>;

    const existing = await pool.query(
      `SELECT * FROM teacher_task_grades WHERE task_id = $1 AND student_id = $2`,
      [task.id, ctx.studentId],
    );
    if (existing.rows[0]?.submitted_at || existing.rows[0]?.grade != null) {
      throw new HttpError(400, 'Task already submitted');
    }

    const questions = await pool.query(
      `SELECT * FROM teacher_task_questions WHERE task_id = $1`,
      [task.id],
    );
    const choices = await pool.query(
      `SELECT c.* FROM teacher_task_choices c
       JOIN teacher_task_questions q ON q.id = c.question_id
       WHERE q.task_id = $1`,
      [task.id],
    );
    const choicesByQ = new Map<number, typeof choices.rows>();
    for (const c of choices.rows) {
      const list = choicesByQ.get(c.question_id) || [];
      list.push(c);
      choicesByQ.set(c.question_id, list);
    }
    const answerMap = new Map(body.answers.map((a) => [a.question_id, a]));

    let autoScore = 0;
    let autoMax = 0;
    let hasWritten = false;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM student_task_answers WHERE task_id = $1 AND student_id = $2`,
        [task.id, ctx.studentId],
      );

      for (const q of questions.rows) {
        const ans = answerMap.get(q.id);
        const pts = Number(q.points);
        if (q.type === 'mcq') {
          autoMax += pts;
          const qChoices = choicesByQ.get(q.id) || [];
          const chosen = qChoices.find((c) => c.id === ans?.choice_id);
          const correct = qChoices.find((c) => c.is_correct);
          const isCorrect = !!(chosen && correct && chosen.id === correct.id);
          const awarded = isCorrect ? pts : 0;
          autoScore += awarded;
          await client.query(
            `INSERT INTO student_task_answers
               (task_id, student_id, question_id, choice_id, written_answer, is_correct, points_awarded)
             VALUES ($1,$2,$3,$4,NULL,$5,$6)`,
            [task.id, ctx.studentId, q.id, ans?.choice_id ?? null, isCorrect, awarded],
          );
        } else {
          hasWritten = true;
          await client.query(
            `INSERT INTO student_task_answers
               (task_id, student_id, question_id, choice_id, written_answer, is_correct, points_awarded)
             VALUES ($1,$2,$3,NULL,$4,NULL,0)`,
            [task.id, ctx.studentId, q.id, ans?.written_answer ?? null],
          );
        }
      }

      // Pure MCQ → auto grade; otherwise wait for teacher (optionally store auto MCQ as hint via null grade)
      const gradeValue =
        questions.rows.length > 0 && !hasWritten
          ? Math.min(Number(task.max_grade), autoScore)
          : null;

      await client.query(
        `INSERT INTO teacher_task_grades
           (task_id, student_id, grade, review, graded_at, submitted_at, submission_note)
         VALUES (
           $1, $2, $3::numeric, NULL,
           CASE WHEN $3::numeric IS NULL THEN NULL ELSE NOW() END,
           NOW(), $4::text
         )
         ON CONFLICT (task_id, student_id) DO UPDATE SET
           grade = EXCLUDED.grade,
           graded_at = EXCLUDED.graded_at,
           submitted_at = NOW(),
           submission_note = EXCLUDED.submission_note,
           updated_at = NOW()`,
        [task.id, ctx.studentId, gradeValue, body.submission_note ?? null],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      message: 'Task submitted',
      auto_scored: !hasWritten && questions.rows.length > 0,
      score: !hasWritten && questions.rows.length > 0 ? autoScore : null,
      max_score: Number(task.max_grade),
      mcq_score: autoScore,
      mcq_max: autoMax,
    });
  }),
);

/** Exams list */
router.get(
  '/portal/exams',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const subjectId = req.query.subject_id ? Number(req.query.subject_id) : null;
    const values: unknown[] = [ctx.classroomId, ctx.schoolId, ctx.studentId];
    let filter = '';
    if (subjectId) {
      values.push(subjectId);
      filter = ` AND e.subject_id = $${values.length}`;
    }
    const result = await pool.query(
      `SELECT e.*, s.name AS subject_name, u.name AS teacher_name,
         (SELECT COUNT(*)::int FROM teacher_exam_questions q WHERE q.exam_id = e.id) AS questions_count,
         a.id AS attempt_id, a.score, a.max_score AS attempt_max, a.submitted_at AS attempt_at
       FROM teacher_exams e
       JOIN subjects s ON s.id = e.subject_id
       JOIN users u ON u.id = e.teacher_id
       LEFT JOIN student_exam_attempts a
         ON a.exam_id = e.id AND a.student_id = $3
       WHERE e.classroom_id = $1 AND e.school_id = $2
         AND e.deleted_at IS NULL AND e.status IN ('published', 'closed')${filter}
       ORDER BY e.created_at DESC`,
      values,
    );
    res.json({
      exams: result.rows.map((e) => ({
        id: String(e.id),
        subjectId: String(e.subject_id),
        subjectName: e.subject_name,
        teacherName: e.teacher_name,
        title: e.title,
        description: e.description || '',
        durationMin: e.duration_minutes || 30,
        totalPoints: Number(e.total_points),
        questionsCount: Number(e.questions_count),
        status: e.status,
        date: e.created_at,
        attempted: !!e.attempt_id,
        attemptId: e.attempt_id != null ? String(e.attempt_id) : null,
        score: e.score != null ? Number(e.score) : null,
        maxScore: e.attempt_max != null ? Number(e.attempt_max) : Number(e.total_points),
        questionIds: Array.from({ length: Number(e.questions_count) }, (_, i) =>
          String(i),
        ),
        difficulty: 'medium' as const,
        isOfficial: true,
      })),
    });
  }),
);

/** Exam detail (hide correct flags until submitted) */
router.get(
  '/portal/exams/:id',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const exam = await assertStudentOwnsExam(ctx, Number(req.params.id));

    const [questions, choices, attempt] = await Promise.all([
      pool.query(
        `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
        [exam.id],
      ),
      pool.query(
        `SELECT c.* FROM teacher_exam_choices c
         JOIN teacher_exam_questions q ON q.id = c.question_id
         WHERE q.exam_id = $1
         ORDER BY c.position, c.id`,
        [exam.id],
      ),
      pool.query(
        `SELECT * FROM student_exam_attempts WHERE exam_id = $1 AND student_id = $2`,
        [exam.id, ctx.studentId],
      ),
    ]);

    const submitted = !!attempt.rowCount;
    const byQ = new Map<number, typeof choices.rows>();
    for (const ch of choices.rows) {
      const list = byQ.get(ch.question_id) || [];
      list.push(ch);
      byQ.set(ch.question_id, list);
    }

    let answerRows: {
      question_id: number;
      choice_id: number | null;
      written_answer: string | null;
      is_correct: boolean | null;
      points_awarded: number;
    }[] = [];
    if (submitted) {
      const ans = await pool.query(
        `SELECT * FROM student_exam_answers WHERE attempt_id = $1`,
        [attempt.rows[0].id],
      );
      answerRows = ans.rows;
    }
    const ansByQ = new Map(answerRows.map((a) => [a.question_id, a]));

    res.json({
      exam: {
        id: String(exam.id),
        subjectId: String(exam.subject_id),
        subjectName: exam.subject_name,
        teacherName: exam.teacher_name,
        title: exam.title,
        description: exam.description || '',
        durationMin: exam.duration_minutes || 0,
        totalPoints: Number(exam.total_points),
        status: exam.status,
        date: exam.created_at,
        attempted: submitted,
        attemptId: submitted ? String(attempt.rows[0].id) : null,
        score: submitted ? Number(attempt.rows[0].score) : null,
        maxScore: submitted
          ? Number(attempt.rows[0].max_score)
          : Number(exam.total_points),
        questionIds: questions.rows.map((q) => String(q.id)),
        difficulty: 'medium' as const,
        isOfficial: true,
      },
      questions: questions.rows.map((q) => {
        const qChoices = byQ.get(q.id) || [];
        const ans = ansByQ.get(q.id);
        const correctIndex = qChoices.findIndex((c) => c.is_correct);
        return {
          id: String(q.id),
          type: q.type as 'mcq' | 'written',
          text: q.text,
          points: Number(q.points),
          choices: qChoices.map((c) => c.text),
          choiceIds: qChoices.map((c) => String(c.id)),
          // Legacy mock fields (filled only after submit for review UI)
          correctIndex: submitted ? (correctIndex >= 0 ? correctIndex : 0) : -1,
          difficulty: 'medium' as const,
          explanation: submitted ? q.model_answer || undefined : undefined,
          ...(submitted
            ? {
                modelAnswer: q.model_answer,
                yourChoiceId: ans?.choice_id != null ? String(ans.choice_id) : null,
                yourWritten: ans?.written_answer ?? null,
                isCorrect: ans?.is_correct ?? null,
                pointsAwarded: ans ? Number(ans.points_awarded) : 0,
              }
            : {}),
        };
      }),
    });
  }),
);

/** Submit exam — auto-grade MCQ; written = 0 until teacher grades (v1: MCQ only points) */
router.post(
  '/portal/exams/:id/submit',
  authMiddleware(['student']),
  validate(SubmitExamSchema),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const exam = await assertStudentOwnsExam(ctx, Number(req.params.id));
    if (exam.status === 'closed') {
      throw new HttpError(400, 'Exam is closed');
    }
    const body = req.body as z.infer<typeof SubmitExamSchema>;

    const existing = await pool.query(
      `SELECT id FROM student_exam_attempts WHERE exam_id = $1 AND student_id = $2`,
      [exam.id, ctx.studentId],
    );
    if (existing.rowCount) throw new HttpError(400, 'Exam already submitted');

    const questions = await pool.query(
      `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
      [exam.id],
    );
    const choices = await pool.query(
      `SELECT c.* FROM teacher_exam_choices c
       JOIN teacher_exam_questions q ON q.id = c.question_id
       WHERE q.exam_id = $1`,
      [exam.id],
    );
    const choicesByQ = new Map<number, typeof choices.rows>();
    for (const c of choices.rows) {
      const list = choicesByQ.get(c.question_id) || [];
      list.push(c);
      choicesByQ.set(c.question_id, list);
    }
    const answerMap = new Map(body.answers.map((a) => [a.question_id, a]));

    let score = 0;
    let maxScore = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const attemptRes = await client.query(
        `INSERT INTO student_exam_attempts (exam_id, student_id, score, max_score)
         VALUES ($1, $2, 0, 0) RETURNING *`,
        [exam.id, ctx.studentId],
      );
      const attemptId = attemptRes.rows[0].id;

      for (const q of questions.rows) {
        const pts = Number(q.points);
        maxScore += pts;
        const ans = answerMap.get(q.id);
        if (q.type === 'mcq') {
          const qChoices = choicesByQ.get(q.id) || [];
          const chosen = qChoices.find((c) => c.id === ans?.choice_id);
          const correct = qChoices.find((c) => c.is_correct);
          const isCorrect = !!(chosen && correct && chosen.id === correct.id);
          const awarded = isCorrect ? pts : 0;
          score += awarded;
          await client.query(
            `INSERT INTO student_exam_answers
               (attempt_id, question_id, choice_id, written_answer, is_correct, points_awarded)
             VALUES ($1,$2,$3,NULL,$4,$5)`,
            [attemptId, q.id, ans?.choice_id ?? null, isCorrect, awarded],
          );
        } else {
          await client.query(
            `INSERT INTO student_exam_answers
               (attempt_id, question_id, choice_id, written_answer, is_correct, points_awarded)
             VALUES ($1,$2,NULL,$3,NULL,0)`,
            [attemptId, q.id, ans?.written_answer ?? null],
          );
        }
      }

      await client.query(
        `UPDATE student_exam_attempts
         SET score = $1, max_score = $2, submitted_at = NOW()
         WHERE id = $3`,
        [score, maxScore, attemptId],
      );
      await client.query('COMMIT');

      const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
      res.status(201).json({
        attempt: {
          id: String(attemptId),
          examId: String(exam.id),
          score,
          maxScore,
          percent,
          finishedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

/** Exam result with wrong questions */
router.get(
  '/portal/exams/:id/result',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const exam = await assertStudentOwnsExam(ctx, Number(req.params.id));
    const attempt = await pool.query(
      `SELECT * FROM student_exam_attempts WHERE exam_id = $1 AND student_id = $2`,
      [exam.id, ctx.studentId],
    );
    if (!attempt.rowCount) throw new HttpError(404, 'No attempt found');

    const [questions, choices, answers] = await Promise.all([
      pool.query(
        `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
        [exam.id],
      ),
      pool.query(
        `SELECT c.* FROM teacher_exam_choices c
         JOIN teacher_exam_questions q ON q.id = c.question_id
         WHERE q.exam_id = $1
         ORDER BY c.position, c.id`,
        [exam.id],
      ),
      pool.query(
        `SELECT * FROM student_exam_answers WHERE attempt_id = $1`,
        [attempt.rows[0].id],
      ),
    ]);

    const byQ = new Map<number, typeof choices.rows>();
    for (const ch of choices.rows) {
      const list = byQ.get(ch.question_id) || [];
      list.push(ch);
      byQ.set(ch.question_id, list);
    }
    const ansByQ = new Map(answers.rows.map((a) => [a.question_id, a]));
    const score = Number(attempt.rows[0].score);
    const maxScore = Number(attempt.rows[0].max_score);

    const answersRecord: Record<string, number> = {};
    for (const a of answers.rows) {
      if (a.choice_id != null) {
        const qChoices = byQ.get(a.question_id) || [];
        const idx = qChoices.findIndex((c) => c.id === a.choice_id);
        if (idx >= 0) answersRecord[String(a.question_id)] = idx;
      }
    }

    res.json({
      attempt: {
        id: String(attempt.rows[0].id),
        examId: String(exam.id),
        score,
        maxScore,
        percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
        finishedAt: attempt.rows[0].submitted_at,
        answers: answersRecord,
      },
      exam: {
        id: String(exam.id),
        title: exam.title,
        subjectName: exam.subject_name,
      },
      questions: questions.rows.map((q) => {
        const qChoices = byQ.get(q.id) || [];
        const ans = ansByQ.get(q.id);
        const correctIndex = qChoices.findIndex((c) => c.is_correct);
        return {
          id: String(q.id),
          type: q.type,
          text: q.text,
          points: Number(q.points),
          choices: qChoices.map((c) => c.text),
          choiceIds: qChoices.map((c) => String(c.id)),
          correctIndex: correctIndex >= 0 ? correctIndex : 0,
          explanation: q.model_answer || undefined,
          difficulty: 'medium' as const,
          yourChoiceId: ans?.choice_id != null ? String(ans.choice_id) : null,
          yourWritten: ans?.written_answer ?? null,
          isCorrect: ans?.is_correct ?? null,
          pointsAwarded: ans ? Number(ans.points_awarded) : 0,
        };
      }),
    });
  }),
);

/** Results overview */
router.get(
  '/portal/results',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const [examAttempts, taskGrades] = await Promise.all([
      pool.query(
        `SELECT a.*, e.title AS exam_title, e.subject_id, s.name AS subject_name
         FROM student_exam_attempts a
         JOIN teacher_exams e ON e.id = a.exam_id
         JOIN subjects s ON s.id = e.subject_id
         WHERE a.student_id = $1 AND e.classroom_id = $2 AND e.deleted_at IS NULL
         ORDER BY a.submitted_at DESC`,
        [ctx.studentId, ctx.classroomId],
      ),
      pool.query(
        `SELECT tg.*, t.title AS task_title, t.max_grade, t.subject_id, s.name AS subject_name
         FROM teacher_task_grades tg
         JOIN teacher_tasks t ON t.id = tg.task_id
         JOIN subjects s ON s.id = t.subject_id
         WHERE tg.student_id = $1 AND t.classroom_id = $2 AND t.deleted_at IS NULL
           AND tg.grade IS NOT NULL
         ORDER BY tg.graded_at DESC NULLS LAST`,
        [ctx.studentId, ctx.classroomId],
      ),
    ]);

    res.json({
      examAttempts: examAttempts.rows.map((a) => ({
        id: String(a.id),
        examId: String(a.exam_id),
        examTitle: a.exam_title,
        subjectId: String(a.subject_id),
        subjectName: a.subject_name,
        score: Number(a.score),
        maxScore: Number(a.max_score),
        percent: a.max_score
          ? Math.round((Number(a.score) / Number(a.max_score)) * 100)
          : 0,
        finishedAt: a.submitted_at,
      })),
      taskGrades: taskGrades.rows.map((g) => ({
        id: String(g.id),
        taskId: String(g.task_id),
        taskTitle: g.task_title,
        subjectId: String(g.subject_id),
        subjectName: g.subject_name,
        score: Number(g.grade),
        maxScore: Number(g.max_grade),
        review: g.review,
        gradedAt: g.graded_at,
      })),
    });
  }),
);

/** Notifications */
router.get(
  '/portal/notifications',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const result = await pool.query(
      `SELECT * FROM student_notifications
       WHERE student_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [ctx.studentId],
    );
    res.json({
      notifications: result.rows.map((n) => ({
        id: String(n.id),
        kind: n.kind,
        title: n.title,
        body: n.body,
        at: n.created_at,
        read: !!n.read_at,
        href: n.href,
        refType: n.ref_type,
        refId: n.ref_id != null ? String(n.ref_id) : null,
      })),
    });
  }),
);

/**
 * Published weekly timetable for the student's classroom.
 */
router.get(
  '/portal/timetable',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    const dayRaw = req.query.day as string | undefined;
    const dayFilter =
      dayRaw != null && dayRaw !== '' ? Number(dayRaw) : null;

    const values: unknown[] = [ctx.classroomId, ctx.schoolId];
    const conditions = [
      't.classroom_id = $1',
      't.school_id = $2',
      "t.status = 'published'",
      't.deleted_at IS NULL',
    ];
    if (dayFilter != null && !Number.isNaN(dayFilter)) {
      values.push(dayFilter);
      conditions.push(`ts.day_of_week = $${values.length}`);
    }

    const result = await pool.query(
      `SELECT
         ts.id,
         ts.day_of_week,
         ts.period_number,
         to_char(ts.start_time, 'HH24:MI') AS start_time,
         to_char(ts.end_time, 'HH24:MI') AS end_time,
         ts.slot_type,
         ts.subject_id,
         sub.name AS subject_name,
         ts.teacher_id,
         u.name AS teacher_name,
         ts.notes,
         t.id AS timetable_id,
         t.title AS timetable_title,
         t.academic_year,
         t.term,
         c.name AS classroom_name
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       JOIN classrooms c ON c.id = t.classroom_id
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       LEFT JOIN users u ON u.id = ts.teacher_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ts.day_of_week ASC, ts.period_number ASC, ts.start_time ASC`,
      values,
    );

    const slots = result.rows.map((row) => {
      const style = row.subject_id
        ? subjectStyle(Number(row.subject_id))
        : { color: '#64748B', icon: 'Calendar' };
      return {
        id: String(row.id),
        day: row.day_of_week,
        periodNumber: row.period_number,
        start: row.start_time,
        end: row.end_time,
        slotType: row.slot_type,
        subjectId: row.subject_id != null ? String(row.subject_id) : '',
        subjectName: row.subject_name || null,
        teacherId: row.teacher_id != null ? String(row.teacher_id) : '',
        teacherName: row.teacher_name || null,
        notes: row.notes || null,
        room: row.notes || row.classroom_name || null,
        color: style.color,
      };
    });

    res.json({
      classroomId: String(ctx.classroomId),
      classroomName: ctx.classroomName,
      gradeName: ctx.gradeName,
      academicYear: ctx.academicYear,
      slots,
    });
  }),
);

router.post(
  '/portal/notifications/:id/read',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    await pool.query(
      `UPDATE student_notifications SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND student_id = $2`,
      [req.params.id, ctx.studentId],
    );
    res.json({ message: 'ok' });
  }),
);

router.post(
  '/portal/notifications/read-all',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const ctx = await requireStudentCtx(req.user);
    await pool.query(
      `UPDATE student_notifications SET read_at = NOW()
       WHERE student_id = $1 AND read_at IS NULL`,
      [ctx.studentId],
    );
    res.json({ message: 'ok' });
  }),
);
