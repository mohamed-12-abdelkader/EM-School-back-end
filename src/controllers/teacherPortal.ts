import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import {
  asyncWrapper,
  HttpError,
  uploadsRoot,
  uploadToCloudinary,
} from '../utils';
import pool from '../db/pool';
import type { User } from '../db/types';
import {
  AddAttachmentSchema,
  AddTaskAttachmentSchema,
  CreateExamSchema,
  CreateLessonSchema,
  CreateTaskSchema,
  UpdateAttachmentSchema,
  UpdateExamSchema,
  UpdateLessonSchema,
  UpdateTaskSchema,
  UpsertTaskGradeSchema,
} from './teacherPortal.modules';
import {
  notifyClassroomStudents,
  notifyStudent,
} from '../services/studentNotifications';

export const router = Router();

const materialsDir = path.join(uploadsRoot, 'materials');
const materialStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(materialsDir, { recursive: true });
    cb(null, materialsDir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const materialUpload = multer({
  storage: materialStorage,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('image/');
    if (ok) cb(null, true);
    else cb(new Error('Only PDF, video, or image files are allowed'));
  },
});

function requireTeacherSchool(user: User | undefined) {
  if (!user?.school_id) {
    throw new HttpError(403, 'Teacher is not linked to a school');
  }
  return { teacherId: user.id, schoolId: user.school_id };
}

async function assertTeacherOwnsClassroomSubject(
  teacherId: number,
  schoolId: number,
  classroomId: number,
  subjectId: number,
) {
  const result = await pool.query(
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
  if (!result.rowCount) {
    throw new HttpError(403, 'This class/subject is not assigned to you');
  }
}

async function localMaterialUrl(filePath: string) {
  const filename = path.basename(filePath);
  const apiBase = (process.env.PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  return `${apiBase}/uploads/materials/${filename}`;
}

async function resolveUploadUrl(file?: Express.Multer.File | null, fallbackUrl?: string) {
  if (file) {
    // Prefer Cloudinary; on failure uploadToCloudinary keeps the file and
    // returns a URL under /uploads/materials/... (same folder multer used).
    const uploaded = await uploadToCloudinary(file.path);
    // Guard: never persist a wrong avatars URL for materials.
    let url = uploaded.secure_url || uploaded.url;
    if (typeof url === 'string' && url.includes('/uploads/avatars/') && file.path.includes(`${path.sep}materials${path.sep}`)) {
      url = await localMaterialUrl(file.path);
    }
    return { url, filename: file.originalname };
  }
  if (fallbackUrl) return { url: fallbackUrl, filename: null as string | null };
  throw new HttpError(400, 'file or file_url is required');
}

/** Dashboard summary */
router.get(
  '/portal/dashboard',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);

    const [classes, lessons, exams, tasks, school] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT t.classroom_id)::int AS c
         FROM timetable_slots ts
         JOIN timetables t ON t.id = ts.timetable_id
         WHERE ts.teacher_id = $1 AND t.school_id = $2
           AND t.status = 'published' AND t.deleted_at IS NULL
           AND ts.slot_type = 'lesson'`,
        [teacherId, schoolId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM teacher_lessons
         WHERE teacher_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [teacherId, schoolId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM teacher_exams
         WHERE teacher_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [teacherId, schoolId],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM teacher_tasks
         WHERE teacher_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [teacherId, schoolId],
      ),
      pool.query(`SELECT id, name FROM schools WHERE id = $1`, [schoolId]),
    ]);

    res.json({
      teacher: {
        id: req.user!.id,
        name: req.user!.name ?? null,
        email: req.user!.email ?? null,
        school_id: schoolId,
      },
      school: school.rows[0] ?? null,
      stats: {
        classes: classes.rows[0].c,
        lessons: lessons.rows[0].c,
        exams: exams.rows[0].c,
        tasks: tasks.rows[0].c,
      },
    });
  }),
);

/** Classes assigned via published timetable */
router.get(
  '/portal/classes',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);

    const result = await pool.query(
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
      [teacherId, schoolId],
    );

    res.json({ classes: result.rows });
  }),
);

router.get(
  '/portal/classes/:classroomId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const classroomId = Number(req.params.classroomId);
    const subjectId = req.query.subject_id ? Number(req.query.subject_id) : undefined;

    if (subjectId) {
      await assertTeacherOwnsClassroomSubject(teacherId, schoolId, classroomId, subjectId);
    } else {
      const owned = await pool.query(
        `SELECT 1 FROM timetable_slots ts
         JOIN timetables t ON t.id = ts.timetable_id
         WHERE ts.teacher_id = $1 AND t.school_id = $2 AND t.classroom_id = $3
           AND t.status = 'published' AND t.deleted_at IS NULL LIMIT 1`,
        [teacherId, schoolId, classroomId],
      );
      if (!owned.rowCount) throw new HttpError(403, 'This class is not assigned to you');
    }

    const classroom = await pool.query(
      `SELECT c.id, c.name, g.id AS grade_id, g.name AS grade_name
       FROM classrooms c JOIN grades g ON g.id = c.grade_id
       WHERE c.id = $1 AND c.school_id = $2 AND c.deleted_at IS NULL`,
      [classroomId, schoolId],
    );
    if (!classroom.rowCount) throw new HttpError(404, 'Classroom not found');

    const subjects = await pool.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.teacher_id = $1 AND t.school_id = $2 AND t.classroom_id = $3
         AND t.status = 'published' AND t.deleted_at IS NULL
       ORDER BY sub.name`,
      [teacherId, schoolId, classroomId],
    );

    const students = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, sp.seat_number, sp.status
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.classroom_id = $1
         AND u.school_id = $2
         AND u.role = 'student'
         AND u.deleted_at IS NULL
       ORDER BY u.name`,
      [classroomId, schoolId],
    );

    const slots = await pool.query(
      `SELECT ts.day_of_week, ts.period_number, ts.start_time::text AS start_time,
              ts.end_time::text AS end_time, sub.name AS subject_name, sub.id AS subject_id
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ts.teacher_id = $1 AND t.school_id = $2 AND t.classroom_id = $3
         AND t.status = 'published' AND t.deleted_at IS NULL AND ts.slot_type = 'lesson'
       ORDER BY ts.day_of_week, ts.period_number`,
      [teacherId, schoolId, classroomId],
    );

    res.json({
      classroom: classroom.rows[0],
      subjects: subjects.rows,
      students: students.rows,
      slots: slots.rows,
    });
  }),
);

/** Lessons / materials */
router.get(
  '/portal/lessons',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const classroomId = req.query.classroom_id ? Number(req.query.classroom_id) : null;
    const values: unknown[] = [teacherId, schoolId];
    let filter = '';
    if (classroomId) {
      values.push(classroomId);
      filter = ` AND l.classroom_id = $${values.length}`;
    }

    const result = await pool.query(
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
    res.json({ lessons: result.rows });
  }),
);

router.get(
  '/portal/lessons/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const lesson = await pool.query(
      `SELECT l.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name
       FROM teacher_lessons l
       JOIN classrooms c ON c.id = l.classroom_id
       JOIN grades g ON g.id = c.grade_id
       JOIN subjects s ON s.id = l.subject_id
       WHERE l.id = $1 AND l.teacher_id = $2 AND l.school_id = $3 AND l.deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');

    const attachments = await pool.query(
      `SELECT * FROM teacher_lesson_attachments WHERE lesson_id = $1 ORDER BY created_at DESC`,
      [req.params.id],
    );
    res.json({ lesson: lesson.rows[0], attachments: attachments.rows });
  }),
);

router.post(
  '/portal/lessons',
  authMiddleware(['teacher']),
  validate(CreateLessonSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof CreateLessonSchema>;
    await assertTeacherOwnsClassroomSubject(
      teacherId,
      schoolId,
      body.classroom_id,
      body.subject_id,
    );

    const result = await pool.query(
      `INSERT INTO teacher_lessons (school_id, teacher_id, classroom_id, subject_id, title, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [schoolId, teacherId, body.classroom_id, body.subject_id, body.title, body.description ?? null],
    );
    const lesson = result.rows[0];
    await notifyClassroomStudents({
      schoolId,
      classroomId: body.classroom_id,
      kind: 'lesson',
      title: 'درس جديد',
      body: lesson.title,
      href: `/lecture/${lesson.id}`,
      refType: 'lesson',
      refId: lesson.id,
    });
    res.status(201).json({ lesson });
  }),
);

router.patch(
  '/portal/lessons/:id',
  authMiddleware(['teacher']),
  validate(UpdateLessonSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof UpdateLessonSchema>;
    const result = await pool.query(
      `UPDATE teacher_lessons
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           updated_at = NOW()
       WHERE id = $3 AND teacher_id = $4 AND school_id = $5 AND deleted_at IS NULL
       RETURNING *`,
      [body.title ?? null, body.description ?? null, req.params.id, teacherId, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Lesson not found');
    res.json({ lesson: result.rows[0] });
  }),
);

router.delete(
  '/portal/lessons/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
      `UPDATE teacher_lessons SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, teacherId, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Lesson not found');
    res.json({ message: 'Lesson deleted' });
  }),
);

router.post(
  '/portal/lessons/:id/attachments',
  authMiddleware(['teacher']),
  materialUpload.single('file'),
  validate(AddAttachmentSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof AddAttachmentSchema>;

    const lesson = await pool.query(
      `SELECT id FROM teacher_lessons
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');

    // Prefer real file type over client toggle (avoids PDF saved/shown as video)
    let kind = body.kind;
    if (req.file) {
      const isPdf =
        req.file.mimetype === 'application/pdf' ||
        /\.pdf$/i.test(req.file.originalname || '');
      const isVideo = req.file.mimetype.startsWith('video/');
      if (isPdf) kind = 'pdf';
      else if (isVideo) kind = 'video';
      else if (body.kind === 'pdf' && !isPdf) {
        throw new HttpError(400, 'File must be a PDF');
      } else if (body.kind === 'video' && !isVideo) {
        throw new HttpError(400, 'File must be a video');
      }
    } else if (body.file_url && /\.pdf(\?|$)/i.test(body.file_url)) {
      kind = 'pdf';
    }

    const resolved = await resolveUploadUrl(req.file, body.file_url);
    const result = await pool.query(
      `INSERT INTO teacher_lesson_attachments (lesson_id, kind, title, file_url, filename)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.params.id,
        kind,
        body.title,
        resolved.url,
        resolved.filename ?? body.filename ?? null,
      ],
    );
    res.status(201).json({ attachment: result.rows[0] });
  }),
);

router.patch(
  '/portal/lessons/:lessonId/attachments/:attachmentId',
  authMiddleware(['teacher']),
  materialUpload.single('file'),
  validate(UpdateAttachmentSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof UpdateAttachmentSchema>;

    const existing = await pool.query(
      `SELECT a.*
       FROM teacher_lesson_attachments a
       JOIN teacher_lessons l ON l.id = a.lesson_id
       WHERE a.id = $1 AND a.lesson_id = $2
         AND l.teacher_id = $3 AND l.school_id = $4 AND l.deleted_at IS NULL`,
      [req.params.attachmentId, req.params.lessonId, teacherId, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Attachment not found');

    const current = existing.rows[0];
    const nextKind = body.kind ?? current.kind;

    if (req.file) {
      const isPdf = req.file.mimetype === 'application/pdf';
      const isVideo = req.file.mimetype.startsWith('video/');
      if (nextKind === 'pdf' && !isPdf) throw new HttpError(400, 'File must be a PDF');
      if (nextKind === 'video' && !isVideo) throw new HttpError(400, 'File must be a video');
    }

    let nextUrl = current.file_url as string;
    let nextFilename = current.filename as string | null;
    if (req.file || body.file_url) {
      const resolved = await resolveUploadUrl(req.file, body.file_url);
      nextUrl = resolved.url;
      nextFilename = resolved.filename ?? body.filename ?? nextFilename;
    }

    const result = await pool.query(
      `UPDATE teacher_lesson_attachments
       SET kind = $1,
           title = COALESCE($2, title),
           file_url = $3,
           filename = COALESCE($4, filename)
       WHERE id = $5 AND lesson_id = $6
       RETURNING *`,
      [
        nextKind,
        body.title ?? null,
        nextUrl,
        nextFilename,
        req.params.attachmentId,
        req.params.lessonId,
      ],
    );
    res.json({ attachment: result.rows[0] });
  }),
);

router.delete(
  '/portal/lessons/:lessonId/attachments/:attachmentId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
      `DELETE FROM teacher_lesson_attachments a
       USING teacher_lessons l
       WHERE a.id = $1 AND a.lesson_id = $2 AND a.lesson_id = l.id
         AND l.teacher_id = $3 AND l.school_id = $4
       RETURNING a.id`,
      [req.params.attachmentId, req.params.lessonId, teacherId, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Attachment not found');
    res.json({ message: 'Attachment deleted' });
  }),
);

/** Exams */
router.get(
  '/portal/exams',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
      `SELECT e.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name,
         (SELECT COUNT(*)::int FROM teacher_exam_questions q WHERE q.exam_id = e.id) AS questions_count
       FROM teacher_exams e
       JOIN classrooms c ON c.id = e.classroom_id
       JOIN grades g ON g.id = c.grade_id
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.teacher_id = $1 AND e.school_id = $2 AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC`,
      [teacherId, schoolId],
    );
    res.json({ exams: result.rows });
  }),
);

router.get(
  '/portal/exams/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const exam = await pool.query(
      `SELECT e.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name
       FROM teacher_exams e
       JOIN classrooms c ON c.id = e.classroom_id
       JOIN grades g ON g.id = c.grade_id
       JOIN subjects s ON s.id = e.subject_id
       WHERE e.id = $1 AND e.teacher_id = $2 AND e.school_id = $3 AND e.deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!exam.rowCount) throw new HttpError(404, 'Exam not found');

    const questions = await pool.query(
      `SELECT * FROM teacher_exam_questions WHERE exam_id = $1 ORDER BY position, id`,
      [req.params.id],
    );
    const choices = await pool.query(
      `SELECT c.* FROM teacher_exam_choices c
       JOIN teacher_exam_questions q ON q.id = c.question_id
       WHERE q.exam_id = $1
       ORDER BY c.position, c.id`,
      [req.params.id],
    );
    const byQ = new Map<number, typeof choices.rows>();
    for (const ch of choices.rows) {
      const list = byQ.get(ch.question_id) || [];
      list.push(ch);
      byQ.set(ch.question_id, list);
    }

    res.json({
      exam: exam.rows[0],
      questions: questions.rows.map((q) => ({
        ...q,
        choices: byQ.get(q.id) || [],
      })),
    });
  }),
);

async function insertExamQuestions(
  client: PoolClient,
  examId: number,
  questions: z.infer<typeof CreateExamSchema>['questions'],
) {
  let total = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.type === 'mcq') {
      const choices = q.choices || [];
      if (choices.length < 2) throw new HttpError(400, 'MCQ needs at least 2 choices');
      if (!choices.some((c) => c.is_correct)) {
        throw new HttpError(400, 'MCQ needs at least one correct choice');
      }
    }
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

router.post(
  '/portal/exams',
  authMiddleware(['teacher']),
  validate(CreateExamSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof CreateExamSchema>;
    await assertTeacherOwnsClassroomSubject(
      teacherId,
      schoolId,
      body.classroom_id,
      body.subject_id,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const examRes = await client.query(
        `INSERT INTO teacher_exams
           (school_id, teacher_id, classroom_id, subject_id, title, description, status, duration_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          schoolId,
          teacherId,
          body.classroom_id,
          body.subject_id,
          body.title,
          body.description ?? null,
          body.status ?? 'draft',
          body.duration_minutes ?? null,
        ],
      );
      await insertExamQuestions(client, examRes.rows[0].id, body.questions);
      await client.query('COMMIT');
      const fresh = await pool.query(`SELECT * FROM teacher_exams WHERE id = $1`, [
        examRes.rows[0].id,
      ]);
      const exam = fresh.rows[0];
      if (exam.status === 'published') {
        await notifyClassroomStudents({
          schoolId,
          classroomId: body.classroom_id,
          kind: 'exam',
          title: 'امتحان جديد',
          body: exam.title,
          href: `/exam/${exam.id}`,
          refType: 'exam',
          refId: exam.id,
        });
      }
      res.status(201).json({ exam });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.patch(
  '/portal/exams/:id',
  authMiddleware(['teacher']),
  validate(UpdateExamSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof UpdateExamSchema>;

    const existing = await pool.query(
      `SELECT * FROM teacher_exams
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Exam not found');
    const prevStatus = existing.rows[0].status;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE teacher_exams SET
           title = COALESCE($1, title),
           description = COALESCE($2, description),
           duration_minutes = COALESCE($3, duration_minutes),
           status = COALESCE($4, status),
           updated_at = NOW()
         WHERE id = $5`,
        [
          body.title ?? null,
          body.description ?? null,
          body.duration_minutes ?? null,
          body.status ?? null,
          req.params.id,
        ],
      );
      if (body.questions) {
        await client.query(`DELETE FROM teacher_exam_questions WHERE exam_id = $1`, [
          req.params.id,
        ]);
        await insertExamQuestions(client, Number(req.params.id), body.questions);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const exam = await pool.query(`SELECT * FROM teacher_exams WHERE id = $1`, [req.params.id]);
    const row = exam.rows[0];
    if (prevStatus !== 'published' && row.status === 'published') {
      await notifyClassroomStudents({
        schoolId,
        classroomId: row.classroom_id,
        kind: 'exam',
        title: 'امتحان جديد',
        body: row.title,
        href: `/exam/${row.id}`,
        refType: 'exam',
        refId: row.id,
      });
    }
    res.json({ exam: row });
  }),
);

router.delete(
  '/portal/exams/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
      `UPDATE teacher_exams SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, teacherId, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Exam not found');
    res.json({ message: 'Exam deleted' });
  }),
);

/** Tasks + grades */
router.get(
  '/portal/tasks',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
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
      [teacherId, schoolId],
    );
    res.json({ tasks: result.rows });
  }),
);

async function insertTaskQuestions(
  client: PoolClient,
  taskId: number,
  questions: NonNullable<z.infer<typeof CreateTaskSchema>['questions']>,
) {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.type === 'mcq') {
      const choices = q.choices || [];
      if (choices.length < 2) throw new HttpError(400, 'MCQ needs at least 2 choices');
      if (!choices.some((c) => c.is_correct)) {
        throw new HttpError(400, 'MCQ needs at least one correct choice');
      }
    }
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

router.get(
  '/portal/tasks/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const task = await pool.query(
      `SELECT t.*, c.name AS classroom_name, g.name AS grade_name, s.name AS subject_name
       FROM teacher_tasks t
       JOIN classrooms c ON c.id = t.classroom_id
       JOIN grades g ON g.id = c.grade_id
       JOIN subjects s ON s.id = t.subject_id
       WHERE t.id = $1 AND t.teacher_id = $2 AND t.school_id = $3 AND t.deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!task.rowCount) throw new HttpError(404, 'Task not found');

    const [grades, attachments, questions, choices] = await Promise.all([
      pool.query(
        `SELECT u.id AS student_id, u.name AS student_name, tg.id AS grade_id,
                tg.grade, tg.review, tg.graded_at
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN teacher_task_grades tg ON tg.student_id = u.id AND tg.task_id = $1
         WHERE sp.classroom_id = $2
           AND u.school_id = $3
           AND u.role = 'student'
           AND u.deleted_at IS NULL
         ORDER BY u.name`,
        [req.params.id, task.rows[0].classroom_id, schoolId],
      ),
      pool.query(
        `SELECT * FROM teacher_task_attachments WHERE task_id = $1 ORDER BY created_at DESC`,
        [req.params.id],
      ),
      pool.query(
        `SELECT * FROM teacher_task_questions WHERE task_id = $1 ORDER BY position, id`,
        [req.params.id],
      ),
      pool.query(
        `SELECT c.* FROM teacher_task_choices c
         JOIN teacher_task_questions q ON q.id = c.question_id
         WHERE q.task_id = $1
         ORDER BY c.position, c.id`,
        [req.params.id],
      ),
    ]);

    const byQ = new Map<number, unknown[]>();
    for (const ch of choices.rows) {
      const list = byQ.get(ch.question_id) || [];
      list.push(ch);
      byQ.set(ch.question_id, list);
    }

    res.json({
      task: task.rows[0],
      students: grades.rows,
      attachments: attachments.rows,
      questions: questions.rows.map((q) => ({
        ...q,
        choices: byQ.get(q.id) || [],
      })),
    });
  }),
);

router.post(
  '/portal/tasks',
  authMiddleware(['teacher']),
  validate(CreateTaskSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof CreateTaskSchema>;
    await assertTeacherOwnsClassroomSubject(
      teacherId,
      schoolId,
      body.classroom_id,
      body.subject_id,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO teacher_tasks
           (school_id, teacher_id, classroom_id, subject_id, title, description, max_grade, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          schoolId,
          teacherId,
          body.classroom_id,
          body.subject_id,
          body.title,
          body.description ?? null,
          body.max_grade ?? 100,
          body.due_at ?? null,
        ],
      );
      if (body.questions?.length) {
        await insertTaskQuestions(client, result.rows[0].id, body.questions);
      }
      await client.query('COMMIT');
      const task = result.rows[0];
      await notifyClassroomStudents({
        schoolId,
        classroomId: body.classroom_id,
        kind: 'task',
        title: 'واجب جديد',
        body: task.title,
        href: `/assignment/${task.id}`,
        refType: 'task',
        refId: task.id,
      });
      res.status(201).json({ task });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.post(
  '/portal/tasks/:id/attachments',
  authMiddleware(['teacher']),
  materialUpload.single('file'),
  validate(AddTaskAttachmentSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof AddTaskAttachmentSchema>;

    const task = await pool.query(
      `SELECT id FROM teacher_tasks
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!task.rowCount) throw new HttpError(404, 'Task not found');

    let kind: 'pdf' | 'video' = body.kind || 'pdf';
    if (req.file) {
      const isPdf =
        req.file.mimetype === 'application/pdf' ||
        /\.pdf$/i.test(req.file.originalname || '');
      if (!isPdf) throw new HttpError(400, 'File must be a PDF');
      kind = 'pdf';
    } else if (body.file_url && !/\.pdf(\?|$)/i.test(body.file_url)) {
      throw new HttpError(400, 'Attachment URL must be a PDF');
    }

    const resolved = await resolveUploadUrl(req.file, body.file_url);
    const result = await pool.query(
      `INSERT INTO teacher_task_attachments (task_id, kind, title, file_url, filename)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.params.id,
        kind,
        body.title,
        resolved.url,
        resolved.filename ?? body.filename ?? null,
      ],
    );
    res.status(201).json({ attachment: result.rows[0] });
  }),
);

router.delete(
  '/portal/tasks/:taskId/attachments/:attachmentId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
      `DELETE FROM teacher_task_attachments a
       USING teacher_tasks t
       WHERE a.id = $1 AND a.task_id = $2
         AND a.task_id = t.id
         AND t.teacher_id = $3 AND t.school_id = $4 AND t.deleted_at IS NULL
       RETURNING a.id`,
      [req.params.attachmentId, req.params.taskId, teacherId, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Attachment not found');
    res.json({ message: 'Attachment deleted' });
  }),
);

router.patch(
  '/portal/tasks/:id',
  authMiddleware(['teacher']),
  validate(UpdateTaskSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof UpdateTaskSchema>;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE teacher_tasks SET
           title = COALESCE($1, title),
           description = COALESCE($2, description),
           max_grade = COALESCE($3, max_grade),
           due_at = COALESCE($4, due_at),
           updated_at = NOW()
         WHERE id = $5 AND teacher_id = $6 AND school_id = $7 AND deleted_at IS NULL
         RETURNING *`,
        [
          body.title ?? null,
          body.description ?? null,
          body.max_grade ?? null,
          body.due_at ?? null,
          req.params.id,
          teacherId,
          schoolId,
        ],
      );
      if (!result.rowCount) throw new HttpError(404, 'Task not found');

      if (body.questions) {
        await client.query(`DELETE FROM teacher_task_questions WHERE task_id = $1`, [
          req.params.id,
        ]);
        if (body.questions.length) {
          await insertTaskQuestions(client, Number(req.params.id), body.questions);
        }
      }

      await client.query('COMMIT');
      res.json({ task: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

router.delete(
  '/portal/tasks/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const result = await pool.query(
      `UPDATE teacher_tasks SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, teacherId, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Task not found');
    res.json({ message: 'Task deleted' });
  }),
);

router.put(
  '/portal/tasks/:id/grades',
  authMiddleware(['teacher']),
  validate(UpsertTaskGradeSchema),
  asyncWrapper(async (req, res) => {
    const { teacherId, schoolId } = requireTeacherSchool(req.user);
    const body = req.body as z.infer<typeof UpsertTaskGradeSchema>;

    const task = await pool.query(
      `SELECT * FROM teacher_tasks
       WHERE id = $1 AND teacher_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [req.params.id, teacherId, schoolId],
    );
    if (!task.rowCount) throw new HttpError(404, 'Task not found');

    const student = await pool.query(
      `SELECT u.id FROM users u
       JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'student'
         AND sp.classroom_id = $3 AND u.deleted_at IS NULL`,
      [body.student_id, schoolId, task.rows[0].classroom_id],
    );
    if (!student.rowCount) throw new HttpError(400, 'Student not in this class');

    if (body.grade != null && Number(body.grade) > Number(task.rows[0].max_grade)) {
      throw new HttpError(400, 'Grade exceeds max_grade');
    }

    const result = await pool.query(
      `INSERT INTO teacher_task_grades (task_id, student_id, grade, review, graded_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT (task_id, student_id) DO UPDATE SET
         grade = EXCLUDED.grade,
         review = EXCLUDED.review,
         graded_at = CASE WHEN EXCLUDED.grade IS NULL THEN NULL ELSE NOW() END,
         updated_at = NOW()
       RETURNING *`,
      [req.params.id, body.student_id, body.grade ?? null, body.review ?? null],
    );
    if (body.grade != null) {
      await notifyStudent({
        studentId: body.student_id,
        schoolId,
        kind: 'grade',
        title: 'تم تقييم واجب',
        body: `${task.rows[0].title}: ${body.grade}/${task.rows[0].max_grade}`,
        href: `/assignment/${task.rows[0].id}`,
        refType: 'task',
        refId: task.rows[0].id,
      });
    }
    res.json({ grade: result.rows[0] });
  }),
);
