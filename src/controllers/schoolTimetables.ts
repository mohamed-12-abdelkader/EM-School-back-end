import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CopyTimetableSchema,
  CreateTimetableSchema,
  PublishTimetableSchema,
  ReplaceSlotsSchema,
  UpdateTimetableMetaSchema,
  UpdateTimetableSettingsSchema,
  UpsertPeriodTemplatesSchema,
  UpsertSlotSchema,
} from './schoolTimetables.modules';
import {
  SlotInput,
  validateTimetableSlots,
} from '../services/timetableConflicts';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

async function getSettings(schoolId: number) {
  const existing = await pool.query(
    `SELECT school_id, working_days, periods_per_day, default_period_minutes,
            day_start_time::text AS day_start_time,
            day_end_time::text AS day_end_time,
            allow_teacher_conflicts, updated_at
     FROM timetable_settings WHERE school_id = $1`,
    [schoolId],
  );
  if (existing.rowCount) return existing.rows[0];

  const inserted = await pool.query(
    `INSERT INTO timetable_settings (school_id)
     VALUES ($1)
     RETURNING school_id, working_days, periods_per_day, default_period_minutes,
               day_start_time::text AS day_start_time,
               day_end_time::text AS day_end_time,
               allow_teacher_conflicts, updated_at`,
    [schoolId],
  );
  return inserted.rows[0];
}

async function assertClassroom(schoolId: number, classroomId: number) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.grade_id, g.name AS grade_name
     FROM classrooms c
     JOIN grades g ON g.id = c.grade_id
     WHERE c.id = $1 AND c.school_id = $2 AND c.deleted_at IS NULL
       AND g.deleted_at IS NULL`,
    [classroomId, schoolId],
  );
  if (!result.rowCount) {
    throw new HttpError(404, 'Classroom not found in your school');
  }
  return result.rows[0];
}

async function getOwnedTimetable(schoolId: number, timetableId: number) {
  const result = await pool.query(
    `SELECT t.*,
            c.name AS classroom_name,
            c.grade_id,
            g.name AS grade_name
     FROM timetables t
     JOIN classrooms c ON c.id = t.classroom_id
     JOIN grades g ON g.id = c.grade_id
     WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
    [timetableId, schoolId],
  );
  if (!result.rowCount) {
    throw new HttpError(404, 'Timetable not found');
  }
  return result.rows[0];
}

const SLOT_SELECT = `
  SELECT
    s.id,
    s.timetable_id,
    s.day_of_week,
    s.period_number,
    s.start_time::text AS start_time,
    s.end_time::text AS end_time,
    s.slot_type,
    s.subject_id,
    sub.name AS subject_name,
    sub.code AS subject_code,
    s.teacher_id,
    u.name AS teacher_name,
    u.email AS teacher_email,
    s.notes,
    s.created_at,
    s.updated_at
  FROM timetable_slots s
  LEFT JOIN subjects sub ON sub.id = s.subject_id
  LEFT JOIN users u ON u.id = s.teacher_id
`;

async function loadSlots(timetableId: number) {
  const result = await pool.query(
    `${SLOT_SELECT}
     WHERE s.timetable_id = $1
     ORDER BY s.day_of_week ASC, s.period_number ASC`,
    [timetableId],
  );
  return result.rows;
}

async function replaceSlotsInClient(
  client: { query: typeof pool.query },
  timetableId: number,
  slots: SlotInput[],
) {
  await client.query('DELETE FROM timetable_slots WHERE timetable_id = $1', [timetableId]);

  for (const slot of slots) {
    await client.query(
      `INSERT INTO timetable_slots
         (timetable_id, day_of_week, period_number, start_time, end_time,
          slot_type, subject_id, teacher_id, notes)
       VALUES ($1,$2,$3,$4::time,$5::time,$6,$7,$8,$9)`,
      [
        timetableId,
        slot.day_of_week,
        slot.period_number,
        slot.start_time,
        slot.end_time,
        slot.slot_type,
        slot.slot_type === 'lesson' ? slot.subject_id : null,
        slot.slot_type === 'lesson' ? slot.teacher_id : null,
        slot.notes ?? null,
      ],
    );
  }
}

function normalizeSlot(slot: any): SlotInput {
  return {
    id: slot.id,
    day_of_week: Number(slot.day_of_week),
    period_number: Number(slot.period_number),
    start_time: String(slot.start_time).slice(0, 8),
    end_time: String(slot.end_time).slice(0, 8),
    slot_type: slot.slot_type,
    subject_id: slot.subject_id ?? null,
    teacher_id: slot.teacher_id ?? null,
    notes: slot.notes ?? null,
  };
}

// ---------------- Settings ----------------

router.get(
  '/settings',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const settings = await getSettings(schoolId);
    const periods = await pool.query(
      `SELECT id, school_id, day_of_week, period_number,
              start_time::text AS start_time, end_time::text AS end_time,
              label, slot_type
       FROM timetable_period_templates
       WHERE school_id = $1
       ORDER BY COALESCE(day_of_week, -1), period_number`,
      [schoolId],
    );
    res.json({ settings, period_templates: periods.rows });
  }),
);

router.put(
  '/settings',
  authMiddleware(['school_admin']),
  validate(UpdateTimetableSettingsSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    await getSettings(schoolId);

    const {
      working_days,
      periods_per_day,
      default_period_minutes,
      day_start_time,
      day_end_time,
      allow_teacher_conflicts,
    } = req.body;

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (working_days !== undefined) {
      updates.push(`working_days = $${i++}`);
      values.push(working_days);
    }
    if (periods_per_day !== undefined) {
      updates.push(`periods_per_day = $${i++}`);
      values.push(periods_per_day);
    }
    if (default_period_minutes !== undefined) {
      updates.push(`default_period_minutes = $${i++}`);
      values.push(default_period_minutes);
    }
    if (day_start_time !== undefined) {
      updates.push(`day_start_time = $${i++}::time`);
      values.push(day_start_time);
    }
    if (day_end_time !== undefined) {
      updates.push(`day_end_time = $${i++}::time`);
      values.push(day_end_time);
    }
    if (allow_teacher_conflicts !== undefined) {
      updates.push(`allow_teacher_conflicts = $${i++}`);
      values.push(allow_teacher_conflicts);
    }

    if (!updates.length) {
      throw new HttpError(400, 'No settings to update');
    }

    updates.push('updated_at = NOW()');
    values.push(schoolId);

    const result = await pool.query(
      `UPDATE timetable_settings
       SET ${updates.join(', ')}
       WHERE school_id = $${i}
       RETURNING school_id, working_days, periods_per_day, default_period_minutes,
                 day_start_time::text AS day_start_time,
                 day_end_time::text AS day_end_time,
                 allow_teacher_conflicts, updated_at`,
      values,
    );

    res.json({ message: 'Settings updated', settings: result.rows[0] });
  }),
);

router.put(
  '/period-templates',
  authMiddleware(['school_admin']),
  validate(UpsertPeriodTemplatesSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    await getSettings(schoolId);
    const { periods } = req.body as {
      periods: Array<{
        day_of_week?: number | null;
        period_number: number;
        start_time: string;
        end_time: string;
        label?: string | null;
        slot_type?: string;
      }>;
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM timetable_period_templates WHERE school_id = $1', [
        schoolId,
      ]);

      for (const p of periods) {
        await client.query(
          `INSERT INTO timetable_period_templates
             (school_id, day_of_week, period_number, start_time, end_time, label, slot_type)
           VALUES ($1, $2, $3, $4::time, $5::time, $6, $7)`,
          [
            schoolId,
            p.day_of_week ?? null,
            p.period_number,
            p.start_time,
            p.end_time,
            p.label ?? null,
            p.slot_type ?? 'lesson',
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const rows = await pool.query(
      `SELECT id, school_id, day_of_week, period_number,
              start_time::text AS start_time, end_time::text AS end_time,
              label, slot_type
       FROM timetable_period_templates
       WHERE school_id = $1
       ORDER BY COALESCE(day_of_week, -1), period_number`,
      [schoolId],
    );

    res.json({ message: 'Period templates updated', period_templates: rows.rows });
  }),
);

// ---------------- Helpers for frontend pickers ----------------

router.get(
  '/subjects-for-classroom/:classroomId',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const classroom = await assertClassroom(schoolId, Number(req.params.classroomId));

    const subjects = await pool.query(
      `SELECT s.id, s.name, s.code, s.description
       FROM subjects s
       JOIN subject_grades sg ON sg.subject_id = s.id
       WHERE s.school_id = $1
         AND sg.grade_id = $2
         AND s.deleted_at IS NULL
         AND s.is_active = TRUE
       ORDER BY s.position ASC, s.id ASC`,
      [schoolId, classroom.grade_id],
    );

    res.json({
      classroom_id: classroom.id,
      grade_id: classroom.grade_id,
      subjects: subjects.rows,
    });
  }),
);

router.get(
  '/teachers-for-subject/:subjectId',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const subjectId = Number(req.params.subjectId);

    const subject = await pool.query(
      `SELECT id, name FROM subjects
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL AND is_active = TRUE`,
      [subjectId, schoolId],
    );
    if (!subject.rowCount) {
      throw new HttpError(404, 'Subject not found in your school');
    }

    const teachers = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM users u
       JOIN teacher_subjects ts ON ts.user_id = u.id
       WHERE u.school_id = $1
         AND u.role = 'teacher'
         AND u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND ts.subject_id = $2
       ORDER BY u.name ASC`,
      [schoolId, subjectId],
    );

    res.json({
      subject_id: subjectId,
      subject_name: subject.rows[0].name,
      teachers: teachers.rows,
    });
  }),
);

// ---------------- Timetables CRUD ----------------

router.get(
  '/',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const {
      classroom_id,
      grade_id,
      academic_year,
      term,
      status,
      limit = '50',
      skip = '0',
    } = req.query as Record<string, string | undefined>;

    const values: unknown[] = [schoolId];
    const conditions = ['t.school_id = $1', 't.deleted_at IS NULL'];
    let i = 2;

    if (classroom_id) {
      conditions.push(`t.classroom_id = $${i++}`);
      values.push(Number(classroom_id));
    }
    if (grade_id) {
      conditions.push(`c.grade_id = $${i++}`);
      values.push(Number(grade_id));
    }
    if (academic_year) {
      conditions.push(`t.academic_year = $${i++}`);
      values.push(academic_year);
    }
    if (term) {
      conditions.push(`t.term = $${i++}`);
      values.push(term);
    }
    if (status === 'draft' || status === 'published') {
      conditions.push(`t.status = $${i++}`);
      values.push(status);
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;
    const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM timetables t
       JOIN classrooms c ON c.id = t.classroom_id
       ${whereSQL}`,
      values,
    );

    values.push(limitNum, skipNum);
    const rows = await pool.query(
      `SELECT
         t.id, t.school_id, t.classroom_id, c.name AS classroom_name,
         c.grade_id, g.name AS grade_name,
         t.academic_year, t.term, t.title, t.status,
         t.published_at, t.last_published_at, t.created_at, t.updated_at,
         (SELECT COUNT(*)::int FROM timetable_slots s WHERE s.timetable_id = t.id) AS slots_count
       FROM timetables t
       JOIN classrooms c ON c.id = t.classroom_id
       JOIN grades g ON g.id = c.grade_id
       ${whereSQL}
       ORDER BY t.updated_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      timetables: rows.rows,
      total: count.rows[0].total,
      limit: limitNum,
      skip: skipNum,
    });
  }),
);

router.get(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const slots = await loadSlots(timetable.id);
    const settings = await getSettings(schoolId);

    res.json({
      timetable: {
        id: timetable.id,
        school_id: timetable.school_id,
        classroom_id: timetable.classroom_id,
        classroom_name: timetable.classroom_name,
        grade_id: timetable.grade_id,
        grade_name: timetable.grade_name,
        academic_year: timetable.academic_year,
        term: timetable.term,
        title: timetable.title,
        status: timetable.status,
        published_at: timetable.published_at,
        last_published_at: timetable.last_published_at,
        created_at: timetable.created_at,
        updated_at: timetable.updated_at,
      },
      slots,
      settings,
    });
  }),
);

router.post(
  '/',
  authMiddleware(['school_admin']),
  validate(CreateTimetableSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const userId = req.user!.id;
    const { classroom_id, academic_year, term, title, slots, skip_conflict_check } = req.body;

    const classroom = await assertClassroom(schoolId, classroom_id);
    const settings = await getSettings(schoolId);

    const existing = await pool.query(
      `SELECT id FROM timetables
       WHERE school_id = $1 AND classroom_id = $2 AND academic_year = $3
         AND term = $4 AND deleted_at IS NULL`,
      [schoolId, classroom_id, academic_year, term],
    );
    if (existing.rowCount) {
      throw new HttpError(
        409,
        'A timetable already exists for this classroom, academic year and term',
      );
    }

    const normalized = (slots || []).map(normalizeSlot);
    if (!skip_conflict_check && normalized.length) {
      const conflicts = await validateTimetableSlots({
        schoolId,
        classroomId: classroom_id,
        gradeId: classroom.grade_id,
        academicYear: academic_year,
        term,
        slots: normalized,
        allowTeacherConflicts: settings.allow_teacher_conflicts,
      });
      if (conflicts.length) {
        return res.status(409).json({
          message: 'Timetable has conflicts',
          conflicts,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO timetables
           (school_id, classroom_id, academic_year, term, title, status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'draft',$6,$6)
         RETURNING id`,
        [schoolId, classroom_id, academic_year, term, title ?? null, userId],
      );
      const timetableId = inserted.rows[0].id;
      await replaceSlotsInClient(client, timetableId, normalized);
      await client.query('COMMIT');

      const timetable = await getOwnedTimetable(schoolId, timetableId);
      const savedSlots = await loadSlots(timetableId);

      res.status(201).json({
        message: 'Timetable created successfully',
        timetable: {
          id: timetable.id,
          classroom_id: timetable.classroom_id,
          classroom_name: timetable.classroom_name,
          grade_id: timetable.grade_id,
          grade_name: timetable.grade_name,
          academic_year: timetable.academic_year,
          term: timetable.term,
          title: timetable.title,
          status: timetable.status,
        },
        slots: savedSlots,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }),
);

router.put(
  '/:id',
  authMiddleware(['school_admin']),
  validate(UpdateTimetableMetaSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const { title, academic_year, term } = req.body;

    if (academic_year || term) {
      const nextYear = academic_year ?? timetable.academic_year;
      const nextTerm = term ?? timetable.term;
      const dup = await pool.query(
        `SELECT id FROM timetables
         WHERE school_id = $1 AND classroom_id = $2 AND academic_year = $3
           AND term = $4 AND deleted_at IS NULL AND id <> $5`,
        [schoolId, timetable.classroom_id, nextYear, nextTerm, timetable.id],
      );
      if (dup.rowCount) {
        throw new HttpError(409, 'Another timetable already uses this year/term for the classroom');
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (title !== undefined) {
      updates.push(`title = $${i++}`);
      values.push(title);
    }
    if (academic_year !== undefined) {
      updates.push(`academic_year = $${i++}`);
      values.push(academic_year);
    }
    if (term !== undefined) {
      updates.push(`term = $${i++}`);
      values.push(term);
    }
    if (!updates.length) throw new HttpError(400, 'No fields to update');

    updates.push(`updated_by = $${i++}`);
    values.push(req.user!.id);
    updates.push('updated_at = NOW()');
    if (timetable.status === 'published') {
      updates.push(`status = 'draft'`);
    }

    values.push(timetable.id, schoolId);
    const result = await pool.query(
      `UPDATE timetables SET ${updates.join(', ')}
       WHERE id = $${i} AND school_id = $${i + 1}
       RETURNING id, classroom_id, academic_year, term, title, status, updated_at`,
      values,
    );

    res.json({ message: 'Timetable updated', timetable: result.rows[0] });
  }),
);

router.put(
  '/:id/slots',
  authMiddleware(['school_admin']),
  validate(ReplaceSlotsSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const settings = await getSettings(schoolId);
    const { slots, skip_conflict_check } = req.body;
    const normalized = slots.map(normalizeSlot);

    if (!skip_conflict_check) {
      const conflicts = await validateTimetableSlots({
        schoolId,
        classroomId: timetable.classroom_id,
        gradeId: timetable.grade_id,
        timetableId: timetable.id,
        academicYear: timetable.academic_year,
        term: timetable.term,
        slots: normalized,
        allowTeacherConflicts: settings.allow_teacher_conflicts,
      });
      if (conflicts.length) {
        return res.status(409).json({ message: 'Timetable has conflicts', conflicts });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await replaceSlotsInClient(client, timetable.id, normalized);
      await client.query(
        `UPDATE timetables
         SET updated_at = NOW(), updated_by = $1,
             status = CASE WHEN status = 'published' THEN 'draft'::timetable_status ELSE status END
         WHERE id = $2`,
        [req.user!.id, timetable.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const saved = await loadSlots(timetable.id);
    const updated = await getOwnedTimetable(schoolId, timetable.id);

    res.json({
      message: 'Slots saved successfully',
      timetable: {
        id: updated.id,
        status: updated.status,
        updated_at: updated.updated_at,
      },
      slots: saved,
    });
  }),
);

router.post(
  '/:id/slots',
  authMiddleware(['school_admin']),
  validate(UpsertSlotSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const settings = await getSettings(schoolId);
    const slot = normalizeSlot(req.body);

    const current = await loadSlots(timetable.id);
    const withoutSameCell = current.filter(
      (s) =>
        !(
          Number(s.day_of_week) === slot.day_of_week &&
          Number(s.period_number) === slot.period_number
        ),
    );
    const nextSlots = [...withoutSameCell.map(normalizeSlot), slot];

    const conflicts = await validateTimetableSlots({
      schoolId,
      classroomId: timetable.classroom_id,
      gradeId: timetable.grade_id,
      timetableId: timetable.id,
      academicYear: timetable.academic_year,
      term: timetable.term,
      slots: nextSlots,
      allowTeacherConflicts: settings.allow_teacher_conflicts,
    });
    if (conflicts.length) {
      return res.status(409).json({ message: 'Slot has conflicts', conflicts });
    }

    const upserted = await pool.query(
      `INSERT INTO timetable_slots
         (timetable_id, day_of_week, period_number, start_time, end_time,
          slot_type, subject_id, teacher_id, notes)
       VALUES ($1,$2,$3,$4::time,$5::time,$6,$7,$8,$9)
       ON CONFLICT (timetable_id, day_of_week, period_number)
       DO UPDATE SET
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         slot_type = EXCLUDED.slot_type,
         subject_id = EXCLUDED.subject_id,
         teacher_id = EXCLUDED.teacher_id,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id`,
      [
        timetable.id,
        slot.day_of_week,
        slot.period_number,
        slot.start_time,
        slot.end_time,
        slot.slot_type,
        slot.slot_type === 'lesson' ? slot.subject_id : null,
        slot.slot_type === 'lesson' ? slot.teacher_id : null,
        slot.notes ?? null,
      ],
    );

    await pool.query(
      `UPDATE timetables
       SET updated_at = NOW(), updated_by = $1,
           status = CASE WHEN status = 'published' THEN 'draft'::timetable_status ELSE status END
       WHERE id = $2`,
      [req.user!.id, timetable.id],
    );

    const rows = await pool.query(`${SLOT_SELECT} WHERE s.id = $1`, [upserted.rows[0].id]);
    res.status(201).json({ message: 'Slot saved', slot: rows.rows[0] });
  }),
);

router.put(
  '/:id/slots/:slotId',
  authMiddleware(['school_admin']),
  validate(UpsertSlotSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const slotId = Number(req.params.slotId);
    const settings = await getSettings(schoolId);
    const slot = normalizeSlot(req.body);

    const existing = await pool.query(
      `SELECT id FROM timetable_slots WHERE id = $1 AND timetable_id = $2`,
      [slotId, timetable.id],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Slot not found');

    const current = await loadSlots(timetable.id);
    const nextSlots = current
      .filter((s) => Number(s.id) !== slotId)
      .filter(
        (s) =>
          !(
            Number(s.day_of_week) === slot.day_of_week &&
            Number(s.period_number) === slot.period_number &&
            Number(s.id) !== slotId
          ),
      )
      .map(normalizeSlot);
    nextSlots.push(slot);

    const conflicts = await validateTimetableSlots({
      schoolId,
      classroomId: timetable.classroom_id,
      gradeId: timetable.grade_id,
      timetableId: timetable.id,
      academicYear: timetable.academic_year,
      term: timetable.term,
      slots: nextSlots,
      allowTeacherConflicts: settings.allow_teacher_conflicts,
    });
    if (conflicts.length) {
      return res.status(409).json({ message: 'Slot has conflicts', conflicts });
    }

    await pool.query(
      `UPDATE timetable_slots
       SET day_of_week = $1, period_number = $2, start_time = $3::time, end_time = $4::time,
           slot_type = $5, subject_id = $6, teacher_id = $7, notes = $8, updated_at = NOW()
       WHERE id = $9 AND timetable_id = $10`,
      [
        slot.day_of_week,
        slot.period_number,
        slot.start_time,
        slot.end_time,
        slot.slot_type,
        slot.slot_type === 'lesson' ? slot.subject_id : null,
        slot.slot_type === 'lesson' ? slot.teacher_id : null,
        slot.notes ?? null,
        slotId,
        timetable.id,
      ],
    );

    await pool.query(
      `UPDATE timetables
       SET updated_at = NOW(), updated_by = $1,
           status = CASE WHEN status = 'published' THEN 'draft'::timetable_status ELSE status END
       WHERE id = $2`,
      [req.user!.id, timetable.id],
    );

    const rows = await pool.query(`${SLOT_SELECT} WHERE s.id = $1`, [slotId]);
    res.json({ message: 'Slot updated', slot: rows.rows[0] });
  }),
);

router.delete(
  '/:id/slots/:slotId',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const slotId = Number(req.params.slotId);

    const result = await pool.query(
      `DELETE FROM timetable_slots
       WHERE id = $1 AND timetable_id = $2
       RETURNING id, day_of_week, period_number`,
      [slotId, timetable.id],
    );
    if (!result.rowCount) throw new HttpError(404, 'Slot not found');

    await pool.query(
      `UPDATE timetables
       SET updated_at = NOW(), updated_by = $1,
           status = CASE WHEN status = 'published' THEN 'draft'::timetable_status ELSE status END
       WHERE id = $2`,
      [req.user!.id, timetable.id],
    );

    res.json({ message: 'Slot deleted', slot: result.rows[0] });
  }),
);

router.post(
  '/:id/validate',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const settings = await getSettings(schoolId);
    const slots = (await loadSlots(timetable.id)).map(normalizeSlot);

    const conflicts = await validateTimetableSlots({
      schoolId,
      classroomId: timetable.classroom_id,
      gradeId: timetable.grade_id,
      timetableId: timetable.id,
      academicYear: timetable.academic_year,
      term: timetable.term,
      slots,
      allowTeacherConflicts: settings.allow_teacher_conflicts,
    });

    res.json({
      valid: conflicts.length === 0,
      conflicts,
    });
  }),
);

router.post(
  '/:id/publish',
  authMiddleware(['school_admin']),
  validate(PublishTimetableSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));
    const settings = await getSettings(schoolId);
    const slots = (await loadSlots(timetable.id)).map(normalizeSlot);

    if (!slots.length) {
      throw new HttpError(400, 'Cannot publish an empty timetable');
    }

    const conflicts = await validateTimetableSlots({
      schoolId,
      classroomId: timetable.classroom_id,
      gradeId: timetable.grade_id,
      timetableId: timetable.id,
      academicYear: timetable.academic_year,
      term: timetable.term,
      slots,
      allowTeacherConflicts: settings.allow_teacher_conflicts,
    });

    if (conflicts.length && !req.body.force) {
      return res.status(409).json({
        message: 'Cannot publish timetable with conflicts',
        conflicts,
      });
    }

    const result = await pool.query(
      `UPDATE timetables
       SET status = 'published',
           published_at = NOW(),
           last_published_at = NOW(),
           published_by = $1,
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2 AND school_id = $3
       RETURNING id, status, published_at, last_published_at`,
      [req.user!.id, timetable.id, schoolId],
    );

    res.json({ message: 'Timetable published', timetable: result.rows[0] });
  }),
);

router.post(
  '/:id/unpublish',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const timetable = await getOwnedTimetable(schoolId, Number(req.params.id));

    const result = await pool.query(
      `UPDATE timetables
       SET status = 'draft', updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND school_id = $3
       RETURNING id, status, last_published_at`,
      [req.user!.id, timetable.id, schoolId],
    );

    res.json({
      message: 'Timetable unpublished (draft)',
      timetable: result.rows[0],
      previous_status: timetable.status,
    });
  }),
);

router.post(
  '/:id/copy',
  authMiddleware(['school_admin']),
  validate(CopyTimetableSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const source = await getOwnedTimetable(schoolId, Number(req.params.id));
    const settings = await getSettings(schoolId);
    const {
      target_classroom_id,
      academic_year,
      term,
      title,
      replace_existing,
      skip_conflict_check,
    } = req.body;

    const target = await assertClassroom(schoolId, target_classroom_id);
    const nextYear = academic_year ?? source.academic_year;
    const nextTerm = term ?? source.term;

    const existing = await pool.query(
      `SELECT id FROM timetables
       WHERE school_id = $1 AND classroom_id = $2 AND academic_year = $3
         AND term = $4 AND deleted_at IS NULL`,
      [schoolId, target_classroom_id, nextYear, nextTerm],
    );

    if (existing.rowCount && !replace_existing) {
      throw new HttpError(
        409,
        'Target classroom already has a timetable for this year/term. Pass replace_existing=true to overwrite.',
      );
    }

    const sourceSlots = (await loadSlots(source.id)).map(normalizeSlot);

    if (!skip_conflict_check) {
      const conflicts = await validateTimetableSlots({
        schoolId,
        classroomId: target_classroom_id,
        gradeId: target.grade_id,
        timetableId: existing.rowCount ? existing.rows[0].id : undefined,
        academicYear: nextYear,
        term: nextTerm,
        slots: sourceSlots,
        allowTeacherConflicts: settings.allow_teacher_conflicts,
      });
      if (conflicts.length) {
        return res.status(409).json({
          message: 'Copied timetable has conflicts in the target classroom',
          conflicts,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let timetableId: number;
      if (existing.rowCount && replace_existing) {
        timetableId = existing.rows[0].id;
        await client.query(
          `UPDATE timetables
           SET title = $1, status = 'draft', updated_by = $2, updated_at = NOW()
           WHERE id = $3`,
          [title ?? source.title, req.user!.id, timetableId],
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO timetables
             (school_id, classroom_id, academic_year, term, title, status, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,'draft',$6,$6)
           RETURNING id`,
          [
            schoolId,
            target_classroom_id,
            nextYear,
            nextTerm,
            title ?? source.title,
            req.user!.id,
          ],
        );
        timetableId = inserted.rows[0].id;
      }

      await replaceSlotsInClient(client, timetableId, sourceSlots);
      await client.query('COMMIT');

      const timetable = await getOwnedTimetable(schoolId, timetableId);
      const slots = await loadSlots(timetableId);

      res.status(201).json({
        message: 'Timetable copied successfully',
        timetable: {
          id: timetable.id,
          classroom_id: timetable.classroom_id,
          classroom_name: timetable.classroom_name,
          grade_id: timetable.grade_id,
          academic_year: timetable.academic_year,
          term: timetable.term,
          status: timetable.status,
        },
        slots,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }),
);

router.delete(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const hard = String(req.query.hard || 'false') === 'true';
    const id = Number(req.params.id);

    if (hard) {
      const result = await pool.query(
        `DELETE FROM timetables
         WHERE id = $1 AND school_id = $2
         RETURNING id, classroom_id`,
        [id, schoolId],
      );
      if (!result.rowCount) throw new HttpError(404, 'Timetable not found');
      return res.json({ message: 'Timetable permanently deleted', timetable: result.rows[0] });
    }

    const result = await pool.query(
      `UPDATE timetables
       SET deleted_at = NOW(), status = 'draft', updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL
       RETURNING id, classroom_id`,
      [req.user!.id, id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Timetable not found or already deleted');

    res.json({ message: 'Timetable deleted', timetable: result.rows[0] });
  }),
);
