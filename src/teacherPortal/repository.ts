import type { PoolClient } from 'pg';
import pool from '../db/pool';
import type { ExamQuestionInput, TeacherCtx } from './types';

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

export async function findAssignedClassroomSubject(
  teacherId: number,
  schoolId: number,
  classroomId: number,
  subjectId: number,
) {
  return pool.query(
    `SELECT 1
     FROM timetable_slots ts
     JOIN timetables t ON t.id = ts.timetable_id
     WHERE ts.teacher_id = $1
       AND t.school_id = $2
       AND t.classroom_id = $3
       AND ts.subject_id = $4
       AND t.status = 'published'
       AND t.deleted_at IS NULL
     LIMIT 1`,
    [teacherId, schoolId, classroomId, subjectId],
  );
}

export async function findAssignedClassroom(
  teacherId: number,
  schoolId: number,
  classroomId: number,
) {
  return pool.query(
    `SELECT 1 FROM timetable_slots ts
     JOIN timetables t ON t.id = ts.timetable_id
     WHERE ts.teacher_id = $1 AND t.school_id = $2 AND t.classroom_id = $3
       AND t.status = 'published' AND t.deleted_at IS NULL LIMIT 1`,
    [teacherId, schoolId, classroomId],
  );
}

export async function queryDashboard(ctx: TeacherCtx) {
  return Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT t.classroom_id)::int AS c
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       WHERE ts.teacher_id = $1 AND t.school_id = $2
         AND t.status = 'published' AND t.deleted_at IS NULL
         AND ts.slot_type = 'lesson'`,
      [ctx.teacherId, ctx.schoolId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM teacher_lessons
       WHERE teacher_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [ctx.teacherId, ctx.schoolId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM teacher_exams
       WHERE teacher_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [ctx.teacherId, ctx.schoolId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM teacher_tasks
       WHERE teacher_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [ctx.teacherId, ctx.schoolId],
    ),
    pool.query(`SELECT id, name FROM schools WHERE id = $1`, [ctx.schoolId]),
  ]);
}

export async function listClasses(ctx: TeacherCtx) {
  return pool.query(
    `SELECT
       c.id AS classroom_id,
       c.name AS classroom_name,
       g.id AS grade_id,
       g.name AS grade_name,
       sub.id AS subject_id,
       sub.name AS subject_name,
       COUNT(*)::int AS weekly_slots,
       (
         SELECT COUNT(*)::int
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.classroom_id = c.id
           AND u.school_id = $2
           AND u.role = 'student'
           AND u.deleted_at IS NULL
           AND COALESCE(sp.status, 'active') = 'active'
       ) AS students_count
     FROM timetable_slots ts
     JOIN timetables t ON t.id = ts.timetable_id
     JOIN classrooms c ON c.id = t.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects sub ON sub.id = ts.subject_id
     WHERE ts.teacher_id = $1
       AND t.school_id = $2
       AND t.status = 'published'
       AND t.deleted_at IS NULL
       AND ts.slot_type = 'lesson'
       AND ts.subject_id IS NOT NULL
     GROUP BY c.id, c.name, g.id, g.name, sub.id, sub.name
     ORDER BY g.name, c.name, sub.name`,
    [ctx.teacherId, ctx.schoolId],
  );
}

export async function findClassroom(classroomId: number, schoolId: number) {
  return pool.query(
    `SELECT c.id, c.name, g.id AS grade_id, g.name AS grade_name
     FROM classrooms c JOIN grades g ON g.id = c.grade_id
     WHERE c.id = $1 AND c.school_id = $2 AND c.deleted_at IS NULL`,
    [classroomId, schoolId],
  );
}

export async function queryClassDetail(ctx: TeacherCtx, classroomId: number) {
  return Promise.all([
    pool.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.teacher_id = $1 AND t.school_id = $2 AND t.classroom_id = $3
         AND t.status = 'published' AND t.deleted_at IS NULL
       ORDER BY sub.name`,
      [ctx.teacherId, ctx.schoolId, classroomId],
    ),
    pool.query(
      `SELECT u.id, u.name, u.email, u.phone, sp.seat_number, sp.status
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.classroom_id = $1
         AND u.school_id = $2
         AND u.role = 'student'
         AND u.deleted_at IS NULL
       ORDER BY u.name`,
      [classroomId, ctx.schoolId],
    ),
    pool.query(
      `SELECT ts.day_of_week, ts.period_number, ts.start_time::text AS start_time,
              ts.end_time::text AS end_time, sub.name AS subject_name, sub.id AS subject_id
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.teacher_id = $1 AND t.school_id = $2 AND t.classroom_id = $3
         AND t.status = 'published' AND t.deleted_at IS NULL AND ts.slot_type = 'lesson'
       ORDER BY ts.day_of_week, ts.period_number`,
      [ctx.teacherId, ctx.schoolId, classroomId],
    ),
  ]);
}

export async function listLessons(ctx: TeacherCtx, classroomId: number | null) {
  const values: unknown[] = [ctx.teacherId, ctx.schoolId];
  let filter = '';
  if (classroomId) {
    values.push(classroomId);
    filter = ` AND l.classroom_id = $${values.length}`;
  }
  return pool.query(
    `SELECT l.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name,
       (SELECT COUNT(*)::int FROM teacher_lesson_attachments a WHERE a.lesson_id = l.id) AS attachments_count
     FROM teacher_lessons l
     JOIN classrooms c ON c.id = l.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects s ON s.id = l.subject_id
     WHERE l.teacher_id = $1 AND l.school_id = $2 AND l.deleted_at IS NULL ${filter}
     ORDER BY l.created_at DESC`,
    values,
  );
}

export async function findLesson(ctx: TeacherCtx, lessonId: string | number) {
  return pool.query(
    `SELECT l.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name
     FROM teacher_lessons l
     JOIN classrooms c ON c.id = l.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects s ON s.id = l.subject_id
     WHERE l.id = $1 AND l.teacher_id = $2 AND l.school_id = $3 AND l.deleted_at IS NULL`,
    [lessonId, ctx.teacherId, ctx.schoolId],
  );
}

export async function listLessonAttachments(lessonId: string | number) {
  return pool.query(
    `SELECT * FROM teacher_lesson_attachments WHERE lesson_id = $1 ORDER BY created_at DESC`,
    [lessonId],
  );
}

export async function insertLesson(
  ctx: TeacherCtx,
  input: {
    classroom_id: number;
    subject_id: number;
    title: string;
    description?: string | null;
  },
) {
  return pool.query(
    `INSERT INTO teacher_lessons (school_id, teacher_id, classroom_id, subject_id, title, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      ctx.schoolId,
      ctx.teacherId,
      input.classroom_id,
      input.subject_id,
      input.title,
      input.description ?? null,
    ],
  );
}

export async function updateLesson(
  ctx: TeacherCtx,
  lessonId: string | number,
  input: { title?: string; description?: string | null },
) {
  return pool.query(
    `UPDATE teacher_lessons
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         updated_at = NOW()
     WHERE id = $3 AND teacher_id = $4 AND school_id = $5 AND deleted_at IS NULL
     RETURNING *`,
    [input.title ?? null, input.description ?? null, lessonId, ctx.teacherId, ctx.schoolId],
  );
}

export async function softDeleteLesson(ctx: TeacherCtx, lessonId: string | number) {
  return pool.query(
    `UPDATE teacher_lessons SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [lessonId, ctx.teacherId, ctx.schoolId],
  );
}

export async function findLessonId(ctx: TeacherCtx, lessonId: string | number) {
  return pool.query(
    `SELECT id FROM teacher_lessons
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
    [lessonId, ctx.teacherId, ctx.schoolId],
  );
}

export async function insertLessonAttachment(input: {
  lessonId: string | number;
  kind: string;
  title: string;
  fileUrl: string;
  filename: string | null;
}) {
  return pool.query(
    `INSERT INTO teacher_lesson_attachments (lesson_id, kind, title, file_url, filename)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.lessonId, input.kind, input.title, input.fileUrl, input.filename],
  );
}

export async function findLessonAttachment(
  ctx: TeacherCtx,
  lessonId: string | number,
  attachmentId: string | number,
) {
  return pool.query(
    `SELECT a.*
     FROM teacher_lesson_attachments a
     JOIN teacher_lessons l ON l.id = a.lesson_id
     WHERE a.id = $1 AND a.lesson_id = $2
       AND l.teacher_id = $3 AND l.school_id = $4 AND l.deleted_at IS NULL`,
    [attachmentId, lessonId, ctx.teacherId, ctx.schoolId],
  );
}

export async function updateLessonAttachment(input: {
  attachmentId: string | number;
  lessonId: string | number;
  kind: string;
  title: string | null;
  fileUrl: string;
  filename: string | null;
}) {
  return pool.query(
    `UPDATE teacher_lesson_attachments
     SET kind = $1,
         title = COALESCE($2, title),
         file_url = $3,
         filename = COALESCE($4, filename)
     WHERE id = $5 AND lesson_id = $6
     RETURNING *`,
    [
      input.kind,
      input.title,
      input.fileUrl,
      input.filename,
      input.attachmentId,
      input.lessonId,
    ],
  );
}

export async function deleteLessonAttachment(
  ctx: TeacherCtx,
  lessonId: string | number,
  attachmentId: string | number,
) {
  return pool.query(
    `DELETE FROM teacher_lesson_attachments a
     USING teacher_lessons l
     WHERE a.id = $1 AND a.lesson_id = $2 AND a.lesson_id = l.id
       AND l.teacher_id = $3 AND l.school_id = $4
     RETURNING a.id`,
    [attachmentId, lessonId, ctx.teacherId, ctx.schoolId],
  );
}

export async function listExams(ctx: TeacherCtx) {
  return pool.query(
    `SELECT e.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name,
       (SELECT COUNT(*)::int FROM teacher_exam_questions q WHERE q.exam_id = e.id) AS questions_count
     FROM teacher_exams e
     JOIN classrooms c ON c.id = e.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects s ON s.id = e.subject_id
     WHERE e.teacher_id = $1 AND e.school_id = $2 AND e.deleted_at IS NULL
     ORDER BY e.created_at DESC`,
    [ctx.teacherId, ctx.schoolId],
  );
}

export async function findExam(ctx: TeacherCtx, examId: string | number) {
  return pool.query(
    `SELECT e.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name
     FROM teacher_exams e
     JOIN classrooms c ON c.id = e.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects s ON s.id = e.subject_id
     WHERE e.id = $1 AND e.teacher_id = $2 AND e.school_id = $3 AND e.deleted_at IS NULL`,
    [examId, ctx.teacherId, ctx.schoolId],
  );
}

export async function findExamRow(ctx: TeacherCtx, examId: string | number) {
  return pool.query(
    `SELECT * FROM teacher_exams
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
    [examId, ctx.teacherId, ctx.schoolId],
  );
}

export async function listExamQuestionsWithChoices(examId: string | number) {
  const [questions, choices] = await Promise.all([
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
  ]);
  return { questions, choices };
}

export async function insertExamQuestions(
  client: PoolClient,
  examId: number,
  questions: ExamQuestionInput[],
) {
  let total = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qRes = await client.query(
      `INSERT INTO teacher_exam_questions (exam_id, type, text, points, position, model_answer)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [examId, q.type, q.text, q.points, i, q.model_answer ?? null],
    );
    total += Number(q.points);
    if (q.type === 'mcq' && q.choices) {
      for (let j = 0; j < q.choices.length; j++) {
        const c = q.choices[j];
        await client.query(
          `INSERT INTO teacher_exam_choices (question_id, text, is_correct, position)
           VALUES ($1, $2, $3, $4)`,
          [qRes.rows[0].id, c.text, c.is_correct, j],
        );
      }
    }
  }
  await client.query(`UPDATE teacher_exams SET total_points = $1, updated_at = NOW() WHERE id = $2`, [
    total,
    examId,
  ]);
}

export async function createExam(
  ctx: TeacherCtx,
  input: {
    classroom_id: number;
    subject_id: number;
    title: string;
    description?: string | null;
    status?: string;
    duration_minutes?: number | null;
    questions: ExamQuestionInput[];
  },
) {
  return withTransaction(async (client) => {
    const examRes = await client.query(
      `INSERT INTO teacher_exams
         (school_id, teacher_id, classroom_id, subject_id, title, description, status, duration_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        ctx.schoolId,
        ctx.teacherId,
        input.classroom_id,
        input.subject_id,
        input.title,
        input.description ?? null,
        input.status ?? 'draft',
        input.duration_minutes ?? null,
      ],
    );
    await insertExamQuestions(client, examRes.rows[0].id, input.questions);
    return examRes.rows[0].id as number;
  });
}

export async function getExamById(examId: number | string) {
  return pool.query(`SELECT * FROM teacher_exams WHERE id = $1`, [examId]);
}

export async function updateExam(
  examId: string | number,
  input: {
    title?: string;
    description?: string | null;
    duration_minutes?: number | null;
    status?: string;
    questions?: ExamQuestionInput[];
  },
) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE teacher_exams SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         duration_minutes = COALESCE($3, duration_minutes),
         status = COALESCE($4, status),
         updated_at = NOW()
       WHERE id = $5`,
      [
        input.title ?? null,
        input.description ?? null,
        input.duration_minutes ?? null,
        input.status ?? null,
        examId,
      ],
    );
    if (input.questions) {
      await client.query(`DELETE FROM teacher_exam_questions WHERE exam_id = $1`, [examId]);
      await insertExamQuestions(client, Number(examId), input.questions);
    }
  });
}

export async function softDeleteExam(ctx: TeacherCtx, examId: string | number) {
  return pool.query(
    `UPDATE teacher_exams SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [examId, ctx.teacherId, ctx.schoolId],
  );
}

export async function listTasks(ctx: TeacherCtx) {
  return pool.query(
    `SELECT t.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name,
       (SELECT COUNT(*)::int FROM teacher_task_grades tg WHERE tg.task_id = t.id AND tg.grade IS NOT NULL) AS graded_count,
       (
         SELECT COUNT(*)::int FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.classroom_id = t.classroom_id AND u.school_id = t.school_id
           AND u.role = 'student' AND u.deleted_at IS NULL
       ) AS students_count
     FROM teacher_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects s ON s.id = t.subject_id
     WHERE t.teacher_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
     ORDER BY t.created_at DESC`,
    [ctx.teacherId, ctx.schoolId],
  );
}

export async function insertTaskQuestions(
  client: PoolClient,
  taskId: number,
  questions: ExamQuestionInput[],
) {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qRes = await client.query(
      `INSERT INTO teacher_task_questions (task_id, type, text, points, position, model_answer)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [taskId, q.type, q.text, q.points, i, q.model_answer ?? null],
    );
    if (q.type === 'mcq' && q.choices) {
      for (let j = 0; j < q.choices.length; j++) {
        const c = q.choices[j];
        await client.query(
          `INSERT INTO teacher_task_choices (question_id, text, is_correct, position)
           VALUES ($1, $2, $3, $4)`,
          [qRes.rows[0].id, c.text, c.is_correct, j],
        );
      }
    }
  }
}

export async function findTask(ctx: TeacherCtx, taskId: string | number) {
  return pool.query(
    `SELECT t.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name
     FROM teacher_tasks t
     JOIN classrooms c ON c.id = t.classroom_id
     JOIN grades g ON g.id = c.grade_id
     JOIN subjects s ON s.id = t.subject_id
     WHERE t.id = $1 AND t.teacher_id = $2 AND t.school_id = $3 AND t.deleted_at IS NULL`,
    [taskId, ctx.teacherId, ctx.schoolId],
  );
}

export async function findTaskRow(ctx: TeacherCtx, taskId: string | number) {
  return pool.query(
    `SELECT * FROM teacher_tasks
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
    [taskId, ctx.teacherId, ctx.schoolId],
  );
}

export async function queryTaskDetail(taskId: string | number, classroomId: number, schoolId: number) {
  return Promise.all([
    pool.query(
      `SELECT u.id AS student_id, u.name AS student_name, tg.id AS grade_id,
              tg.grade, tg.review, tg.graded_at,
              tg.submitted_at, tg.submission_note,
              tg.submission_file_url, tg.submission_filename
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN teacher_task_grades tg ON tg.student_id = u.id AND tg.task_id = $1
       WHERE sp.classroom_id = $2
         AND u.school_id = $3
         AND u.role = 'student'
         AND u.deleted_at IS NULL
       ORDER BY u.name`,
      [taskId, classroomId, schoolId],
    ),
    pool.query(
      `SELECT * FROM teacher_task_attachments WHERE task_id = $1 ORDER BY created_at DESC`,
      [taskId],
    ),
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
  ]);
}

export async function createTask(
  ctx: TeacherCtx,
  input: {
    classroom_id: number;
    subject_id: number;
    title: string;
    description?: string | null;
    max_grade?: number;
    due_at?: string | null;
    submission_mode?: 'questions' | 'pdf';
    questions?: ExamQuestionInput[];
  },
) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO teacher_tasks
         (school_id, teacher_id, classroom_id, subject_id, title, description, max_grade, due_at, submission_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        ctx.schoolId,
        ctx.teacherId,
        input.classroom_id,
        input.subject_id,
        input.title,
        input.description ?? null,
        input.max_grade ?? 100,
        input.due_at ?? null,
        input.submission_mode ?? 'questions',
      ],
    );
    if (input.questions?.length) {
      await insertTaskQuestions(client, result.rows[0].id, input.questions);
    }
    return result.rows[0];
  });
}

export async function findTaskId(ctx: TeacherCtx, taskId: string | number) {
  return pool.query(
    `SELECT id FROM teacher_tasks
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
    [taskId, ctx.teacherId, ctx.schoolId],
  );
}

export async function insertTaskAttachment(input: {
  taskId: string | number;
  kind: string;
  title: string;
  fileUrl: string;
  filename: string | null;
}) {
  return pool.query(
    `INSERT INTO teacher_task_attachments (task_id, kind, title, file_url, filename)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.taskId, input.kind, input.title, input.fileUrl, input.filename],
  );
}

export async function deleteTaskAttachment(
  ctx: TeacherCtx,
  taskId: string | number,
  attachmentId: string | number,
) {
  return pool.query(
    `DELETE FROM teacher_task_attachments a
     USING teacher_tasks t
     WHERE a.id = $1 AND a.task_id = $2
       AND a.task_id = t.id
       AND t.teacher_id = $3 AND t.school_id = $4 AND t.deleted_at IS NULL
     RETURNING a.id`,
    [attachmentId, taskId, ctx.teacherId, ctx.schoolId],
  );
}

export async function updateTask(
  ctx: TeacherCtx,
  taskId: string | number,
  input: {
    title?: string;
    description?: string | null;
    max_grade?: number;
    due_at?: string | null;
    submission_mode?: 'questions' | 'pdf';
    questions?: ExamQuestionInput[];
  },
) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE teacher_tasks SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         max_grade = COALESCE($3, max_grade),
         due_at = COALESCE($4, due_at),
         submission_mode = COALESCE($5::teacher_task_submission_mode, submission_mode),
         updated_at = NOW()
       WHERE id = $6 AND teacher_id = $7 AND school_id = $8 AND deleted_at IS NULL
       RETURNING *`,
      [
        input.title ?? null,
        input.description ?? null,
        input.max_grade ?? null,
        input.due_at ?? null,
        input.submission_mode ?? null,
        taskId,
        ctx.teacherId,
        ctx.schoolId,
      ],
    );
    if (!result.rowCount) return null;

    if (input.questions) {
      await client.query(`DELETE FROM teacher_task_questions WHERE task_id = $1`, [taskId]);
      if (input.questions.length) {
        await insertTaskQuestions(client, Number(taskId), input.questions);
      }
    }
    return result.rows[0];
  });
}

export async function softDeleteTask(ctx: TeacherCtx, taskId: string | number) {
  return pool.query(
    `UPDATE teacher_tasks SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [taskId, ctx.teacherId, ctx.schoolId],
  );
}

export async function findStudentInClassroom(
  studentId: number,
  schoolId: number,
  classroomId: number,
) {
  return pool.query(
    `SELECT u.id FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'student'
       AND sp.classroom_id = $3 AND u.deleted_at IS NULL`,
    [studentId, schoolId, classroomId],
  );
}

export async function upsertTaskGrade(input: {
  taskId: string | number;
  studentId: number;
  grade: number | null;
  review: string | null;
}) {
  return pool.query(
    `INSERT INTO teacher_task_grades (task_id, student_id, grade, review, graded_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END)
     ON CONFLICT (task_id, student_id) DO UPDATE SET
       grade = EXCLUDED.grade,
       review = EXCLUDED.review,
       graded_at = CASE WHEN EXCLUDED.grade IS NULL THEN NULL ELSE NOW() END,
       updated_at = NOW()
     RETURNING *`,
    [input.taskId, input.studentId, input.grade, input.review],
  );
}

export async function findStudentInSchoolClassroom(
  studentId: number,
  schoolId: number,
  classroomId: number,
) {
  return pool.query(
    `SELECT u.id, u.name, sp.classroom_id
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     WHERE u.id = $1
       AND u.school_id = $2
       AND sp.classroom_id = $3
       AND u.role = 'student'
       AND u.deleted_at IS NULL
     LIMIT 1`,
    [studentId, schoolId, classroomId],
  );
}

export async function listStudentOpinions(params: {
  teacherId: number;
  schoolId: number;
  studentId: number;
}) {
  return pool.query(
    `SELECT
       o.id, o.title, o.body, o.subject_id, o.classroom_id,
       o.created_at, o.updated_at,
       s.name AS subject_name
     FROM teacher_student_opinions o
     LEFT JOIN subjects s ON s.id = o.subject_id
     WHERE o.teacher_id = $1
       AND o.school_id = $2
       AND o.student_id = $3
       AND o.deleted_at IS NULL
     ORDER BY o.created_at DESC`,
    [params.teacherId, params.schoolId, params.studentId],
  );
}

export async function insertStudentOpinion(input: {
  schoolId: number;
  teacherId: number;
  studentId: number;
  classroomId: number | null;
  subjectId: number | null;
  title: string | null;
  body: string;
}) {
  return pool.query(
    `INSERT INTO teacher_student_opinions
       (school_id, teacher_id, student_id, classroom_id, subject_id, title, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.schoolId,
      input.teacherId,
      input.studentId,
      input.classroomId,
      input.subjectId,
      input.title,
      input.body,
    ],
  );
}

export async function updateStudentOpinion(input: {
  id: number;
  teacherId: number;
  schoolId: number;
  title?: string | null;
  body?: string;
}) {
  const sets: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let i = 1;
  if (input.title !== undefined) {
    sets.push(`title = $${i++}`);
    values.push(input.title);
  }
  if (input.body !== undefined) {
    sets.push(`body = $${i++}`);
    values.push(input.body);
  }
  values.push(input.id, input.teacherId, input.schoolId);
  return pool.query(
    `UPDATE teacher_student_opinions
     SET ${sets.join(', ')}
     WHERE id = $${i++}
       AND teacher_id = $${i++}
       AND school_id = $${i}
       AND deleted_at IS NULL
     RETURNING *`,
    values,
  );
}

export async function softDeleteStudentOpinion(
  id: number,
  teacherId: number,
  schoolId: number,
) {
  return pool.query(
    `UPDATE teacher_student_opinions
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [id, teacherId, schoolId],
  );
}
