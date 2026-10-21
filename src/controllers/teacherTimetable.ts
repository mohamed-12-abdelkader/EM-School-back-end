import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';

export const router = Router();

/**
 * Published weekly timetable slots for the logged-in school teacher.
 */
router.get(
  '/timetable',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    if (!user.school_id) {
      throw new HttpError(403, 'Teacher is not linked to a school');
    }

    const { academic_year, term } = req.query as {
      academic_year?: string;
      term?: string;
    };

    const values: unknown[] = [user.id, user.school_id];
    const conditions = [
      'ts.teacher_id = $1',
      't.school_id = $2',
      "t.status = 'published'",
      't.deleted_at IS NULL',
    ];
    let i = 3;

    if (academic_year) {
      conditions.push(`t.academic_year = $${i++}`);
      values.push(academic_year);
    }
    if (term) {
      conditions.push(`t.term = $${i++}`);
      values.push(term);
    }

    const result = await pool.query(
      `SELECT
         ts.id,
         ts.day_of_week,
         ts.period_number,
         ts.start_time::text AS start_time,
         ts.end_time::text AS end_time,
         ts.slot_type,
         ts.subject_id,
         sub.name AS subject_name,
         ts.notes,
         t.id AS timetable_id,
         t.academic_year,
         t.term,
         t.classroom_id,
         c.name AS classroom_name,
         g.id AS grade_id,
         g.name AS grade_name
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       JOIN classrooms c ON c.id = t.classroom_id
       JOIN grades g ON g.id = c.grade_id
       LEFT JOIN subjects sub ON sub.id = ts.subject_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.academic_year DESC, ts.day_of_week ASC, ts.period_number ASC`,
      values,
    );

    res.json({
      teacher_id: user.id,
      school_id: user.school_id,
      slots: result.rows,
    });
  }),
);
