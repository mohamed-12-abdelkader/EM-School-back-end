import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';

export const router = Router();

router.get(
  '/available-teachers',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = req.user!.id;

    const studentGradesRes = await pool.query(
      'SELECT grade_id FROM user_grades WHERE user_id = $1',
      [studentId],
    );
    const gradeIds = studentGradesRes.rows.map((row) => row.grade_id);

    if (gradeIds.length === 0) {
      return res.status(404).json({ message: 'Student is not assigned to any grade.' });
    }

    // Get teachers who are assigned to the same grade(s)
    const teachersRes = await pool.query(
      `
      SELECT DISTINCT u.id, u.name, u.avatar
      FROM users u
      JOIN user_grades ug ON u.id = ug.user_id
      WHERE u.role = 'teacher' AND ug.grade_id = ANY($1::int[])
    `,
      [gradeIds],
    );

    res.status(200).json({ teachers: teachersRes.rows });
  }),
);
