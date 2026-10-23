import type { PoolClient } from 'pg';
import pool from '../db/pool';
import type { StudentCtx } from './types';

type Queryable = Pick<typeof pool, 'query'>;

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findStudentProfile(userId: number) {
  return pool.query(
    `SELECT sp.classroom_id, sp.grade_id, sp.academic_year, sp.status,
            g.name AS grade_name, c.name AS classroom_name
     FROM student_profiles sp
     LEFT JOIN grades g ON g.id = sp.grade_id
     LEFT JOIN classrooms c ON c.id = sp.classroom_id
     WHERE sp.user_id = $1`,
    [userId],
  );
}

export async function findOwnedExam(ctx: StudentCtx, examId: number) {
  return pool.query(
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
}

export async function findOwnedTask(ctx: StudentCtx, taskId: number) {
  return pool.query(
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
}

export async function findOwnedLesson(ctx: StudentCtx, lessonId: number) {
  return pool.query(
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
}

export async function queryDashboard(ctx: StudentCtx, todayDow: number) {
  return Promise.all([
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
}

export async function listSubjects(ctx: StudentCtx) {
  return pool.query(
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
}

export async function findSubject(ctx: StudentCtx, subjectId: number) {
  return pool.query(
    `SELECT id, name, description FROM subjects
     WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
    [subjectId, ctx.schoolId],
  );
}

export async function querySubjectDetail(ctx: StudentCtx, subjectId: number) {
  return Promise.all([
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
}

export async function listLessons(ctx: StudentCtx, subjectId: number | null) {
  const values: unknown[] = [ctx.classroomId, ctx.schoolId];
  let filter = '';
  if (subjectId) {
    values.push(subjectId);
    filter = ` AND l.subject_id = $${values.length}`;
  }
  return pool.query(
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
}

export async function listLessonAttachments(lessonId: number) {
  return pool.query(
    `SELECT id, kind, title, file_url, filename, created_at
     FROM teacher_lesson_attachments
     WHERE lesson_id = $1
     ORDER BY created_at ASC`,
    [lessonId],
  );
}

export async function listTasks(ctx: StudentCtx, subjectId: number | null) {
  const values: unknown[] = [ctx.classroomId, ctx.schoolId, ctx.studentId];
  let filter = '';
  if (subjectId) {
    values.push(subjectId);
    filter = ` AND t.subject_id = $${values.length}`;
  }
  return pool.query(
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
}

export async function queryTaskDetail(taskId: number, studentId: number) {
  return Promise.all([
    pool.query(`SELECT * FROM teacher_task_grades WHERE task_id = $1 AND student_id = $2`, [
      taskId,
      studentId,
    ]),
    pool.query(`SELECT * FROM teacher_task_attachments WHERE task_id = $1 ORDER BY created_at`, [
      taskId,
    ]),
    pool.query(
      `SELECT * FROM teacher_task_questions WHERE task_id = $1 ORDER BY position, id`,
      [taskId],
    ),
    pool.query(
      `SELECT c.* FROM teacher_task_choices c
       JOIN teacher_task_questions q ON q.id = c.question_id
       WHERE q.task_id = $1
       ORDER BY c.position, c.id`,
      [taskId],
    ),
    pool.query(`SELECT * FROM student_task_answers WHERE task_id = $1 AND student_id = $2`, [
      taskId,
      studentId,
    ]),
  ]);
}

export async function findTaskGrade(taskId: number, studentId: number) {
  return pool.query(`SELECT * FROM teacher_task_grades WHERE task_id = $1 AND student_id = $2`, [
    taskId,
    studentId,
  ]);
}

export async function listTaskQuestions(taskId: number) {
  return pool.query(`SELECT * FROM teacher_task_questions WHERE task_id = $1`, [taskId]);
}

export async function listTaskChoices(taskId: number) {
  return pool.query(
    `SELECT c.* FROM teacher_task_choices c
     JOIN teacher_task_questions q ON q.id = c.question_id
     WHERE q.task_id = $1`,
    [taskId],
  );
}

export async function saveTaskSubmission(input: {
  taskId: number;
  studentId: number;
  maxGrade: number;
  submissionNote: string | null;
  answers: Array<{
    questionId: number;
    type: string;
    points: number;
    choiceId: number | null;
    writtenAnswer: string | null;
    isCorrect: boolean | null;
    pointsAwarded: number;
  }>;
  gradeValue: number | null;
  submissionFileUrl?: string | null;
  submissionFilename?: string | null;
}) {
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM student_task_answers WHERE task_id = $1 AND student_id = $2`,
      [input.taskId, input.studentId],
    );

    for (const ans of input.answers) {
      if (ans.type === 'mcq') {
        await client.query(
          `INSERT INTO student_task_answers
             (task_id, student_id, question_id, choice_id, written_answer, is_correct, points_awarded)
           VALUES ($1,$2,$3,$4,NULL,$5,$6)`,
          [
            input.taskId,
            input.studentId,
            ans.questionId,
            ans.choiceId,
            ans.isCorrect,
            ans.pointsAwarded,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO student_task_answers
             (task_id, student_id, question_id, choice_id, written_answer, is_correct, points_awarded)
           VALUES ($1,$2,$3,NULL,$4,NULL,0)`,
          [input.taskId, input.studentId, ans.questionId, ans.writtenAnswer],
        );
      }
    }

    await client.query(
      `INSERT INTO teacher_task_grades
         (task_id, student_id, grade, review, graded_at, submitted_at, submission_note,
          submission_file_url, submission_filename)
       VALUES (
         $1, $2, $3::numeric, NULL,
         CASE WHEN $3::numeric IS NULL THEN NULL ELSE NOW() END,
         NOW(), $4::text, $5::text, $6::text
       )
       ON CONFLICT (task_id, student_id) DO UPDATE SET
         grade = EXCLUDED.grade,
         graded_at = EXCLUDED.graded_at,
         submitted_at = NOW(),
         submission_note = EXCLUDED.submission_note,
         submission_file_url = COALESCE(EXCLUDED.submission_file_url, teacher_task_grades.submission_file_url),
         submission_filename = COALESCE(EXCLUDED.submission_filename, teacher_task_grades.submission_filename),
         updated_at = NOW()`,
      [
        input.taskId,
        input.studentId,
        input.gradeValue,
        input.submissionNote,
        input.submissionFileUrl ?? null,
        input.submissionFilename ?? null,
      ],
    );
  });
}

export async function listExams(ctx: StudentCtx, subjectId: number | null) {
  const values: unknown[] = [ctx.classroomId, ctx.schoolId, ctx.studentId];
  let filter = '';
  if (subjectId) {
    values.push(subjectId);
    filter = ` AND e.subject_id = $${values.length}`;
  }
  return pool.query(
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
}

export async function queryExamDetail(examId: number, studentId: number) {
  return Promise.all([
    pool.query(
      `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
      [examId],
    ),
    pool.query(
      `SELECT c.* FROM teacher_exam_choices c
       JOIN teacher_exam_questions q ON q.id = c.question_id
       WHERE q.exam_id = $1
       ORDER BY c.position, c.id`,
      [examId],
    ),
    pool.query(`SELECT * FROM student_exam_attempts WHERE exam_id = $1 AND student_id = $2`, [
      examId,
      studentId,
    ]),
  ]);
}

export async function listExamAnswers(attemptId: number) {
  return pool.query(`SELECT * FROM student_exam_answers WHERE attempt_id = $1`, [attemptId]);
}

export async function findExamAttempt(examId: number, studentId: number) {
  return pool.query(`SELECT id FROM student_exam_attempts WHERE exam_id = $1 AND student_id = $2`, [
    examId,
    studentId,
  ]);
}

export async function listExamQuestions(examId: number) {
  return pool.query(
    `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
    [examId],
  );
}

export async function listExamChoices(examId: number) {
  return pool.query(
    `SELECT c.* FROM teacher_exam_choices c
     JOIN teacher_exam_questions q ON q.id = c.question_id
     WHERE q.exam_id = $1`,
    [examId],
  );
}

export async function saveExamSubmission(input: {
  examId: number;
  studentId: number;
  answers: Array<{
    questionId: number;
    type: string;
    choiceId: number | null;
    writtenAnswer: string | null;
    isCorrect: boolean | null;
    pointsAwarded: number;
  }>;
  score: number;
  maxScore: number;
}) {
  return withTransaction(async (client) => {
    const attemptRes = await client.query(
      `INSERT INTO student_exam_attempts (exam_id, student_id, score, max_score)
       VALUES ($1, $2, 0, 0) RETURNING *`,
      [input.examId, input.studentId],
    );
    const attemptId = attemptRes.rows[0].id;

    for (const ans of input.answers) {
      if (ans.type === 'mcq') {
        await client.query(
          `INSERT INTO student_exam_answers
             (attempt_id, question_id, choice_id, written_answer, is_correct, points_awarded)
           VALUES ($1,$2,$3,NULL,$4,$5)`,
          [attemptId, ans.questionId, ans.choiceId, ans.isCorrect, ans.pointsAwarded],
        );
      } else {
        await client.query(
          `INSERT INTO student_exam_answers
             (attempt_id, question_id, choice_id, written_answer, is_correct, points_awarded)
           VALUES ($1,$2,NULL,$3,NULL,0)`,
          [attemptId, ans.questionId, ans.writtenAnswer],
        );
      }
    }

    await client.query(
      `UPDATE student_exam_attempts
       SET score = $1, max_score = $2, submitted_at = NOW()
       WHERE id = $3`,
      [input.score, input.maxScore, attemptId],
    );

    return attemptId as number;
  });
}

export async function findFullExamAttempt(examId: number, studentId: number) {
  return pool.query(
    `SELECT * FROM student_exam_attempts WHERE exam_id = $1 AND student_id = $2`,
    [examId, studentId],
  );
}

export async function queryExamResultParts(examId: number, attemptId: number) {
  return Promise.all([
    pool.query(
      `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
      [examId],
    ),
    pool.query(
      `SELECT c.* FROM teacher_exam_choices c
       JOIN teacher_exam_questions q ON q.id = c.question_id
       WHERE q.exam_id = $1
       ORDER BY c.position, c.id`,
      [examId],
    ),
    pool.query(`SELECT * FROM student_exam_answers WHERE attempt_id = $1`, [attemptId]),
  ]);
}

export async function queryResults(ctx: StudentCtx) {
  return Promise.all([
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
}

export async function listNotifications(studentId: number) {
  return pool.query(
    `SELECT * FROM student_notifications
     WHERE student_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [studentId],
  );
}

export async function listTimetableSlots(ctx: StudentCtx, dayFilter: number | null) {
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

  return pool.query(
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
}

export async function markNotificationRead(notificationId: string, studentId: number) {
  return pool.query(
    `UPDATE student_notifications SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND student_id = $2`,
    [notificationId, studentId],
  );
}

export async function markAllNotificationsRead(studentId: number) {
  return pool.query(
    `UPDATE student_notifications SET read_at = NOW()
     WHERE student_id = $1 AND read_at IS NULL`,
    [studentId],
  );
}

/** Exported for rare cases where service needs a raw client — prefer named methods. */
export { withTransaction };
export type { Queryable };
