import { Router } from 'express';
import bcrypt from 'bcrypt';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CreateSchoolTeacherSchema,
  UpdateSchoolTeacherSchema,
} from './schoolTeachers.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

async function assertSchoolSubject(schoolId: number, subjectId: number) {
  const result = await pool.query(
    `SELECT id, name FROM subjects
     WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL AND is_active = TRUE`,
    [subjectId, schoolId],
  );
  if (!result.rowCount) {
    throw new HttpError(404, 'Subject not found in your school');
  }
  return result.rows[0];
}

const TEACHER_SELECT = `
  SELECT
    u.id,
    u.school_id,
    u.name,
    u.email,
    u.is_active,
    u.created_at,
    u.deleted_at,
    ts.subject_id,
    s.name AS subject_name,
    s.code AS subject_code
  FROM users u
  JOIN teacher_subjects ts ON ts.user_id = u.id
  JOIN subjects s ON s.id = ts.subject_id
`;

router.get(
  '/',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);

    const {
      limit = '50',
      skip = '0',
      search = '',
      subject_id,
      is_active,
      include_deleted = 'false',
    } = req.query as {
      limit?: string;
      skip?: string;
      search?: string;
      subject_id?: string;
      is_active?: string;
      include_deleted?: string;
    };

    const values: unknown[] = [schoolId];
    const conditions = [
      "u.role = 'teacher'",
      'u.school_id = $1',
    ];
    let i = 2;

    if (include_deleted !== 'true') {
      conditions.push('u.deleted_at IS NULL');
    }

    if (is_active === 'true' || is_active === 'false') {
      conditions.push(`u.is_active = $${i++}`);
      values.push(is_active === 'true');
    }

    if (subject_id) {
      const subjectIdNum = Number(subject_id);
      if (!Number.isInteger(subjectIdNum) || subjectIdNum <= 0) {
        throw new HttpError(400, 'Invalid subject_id');
      }
      await assertSchoolSubject(schoolId, subjectIdNum);
      conditions.push(`ts.subject_id = $${i++}`);
      values.push(subjectIdNum);
    }

    const q = search.trim();
    if (q) {
      conditions.push(
        `(u.name ILIKE $${i} OR u.email ILIKE $${i} OR s.name ILIKE $${i} OR COALESCE(s.code, '') ILIKE $${i})`,
      );
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       JOIN teacher_subjects ts ON ts.user_id = u.id
       JOIN subjects s ON s.id = ts.subject_id
       ${whereSQL}`,
      values,
    );

    const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);
    values.push(limitNum, skipNum);

    const result = await pool.query(
      `${TEACHER_SELECT}
       ${whereSQL}
       ORDER BY u.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      teachers: result.rows,
      total: countResult.rows[0].total,
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
    const { id } = req.params;

    const result = await pool.query(
      `${TEACHER_SELECT}
       WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'teacher' AND u.deleted_at IS NULL`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Teacher not found');
    }

    res.json({ teacher: result.rows[0] });
  }),
);

router.post(
  '/',
  authMiddleware(['school_admin']),
  validate(CreateSchoolTeacherSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { name, email, password, subject_id } = req.body;

    await assertSchoolSubject(schoolId, subject_id);

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) {
      throw new HttpError(409, 'Email is already registered');
    }

    const hashed = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users (email, password, name, role, school_id, is_active)
         VALUES ($1, $2, $3, 'teacher', $4, TRUE)
         RETURNING id`,
        [email, hashed, name, schoolId],
      );

      const teacherId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO teacher_subjects (user_id, subject_id)
         VALUES ($1, $2)`,
        [teacherId, subject_id],
      );

      await client.query('COMMIT');

      const result = await pool.query(`${TEACHER_SELECT} WHERE u.id = $1`, [teacherId]);

      res.status(201).json({
        message: 'Teacher created successfully',
        teacher: result.rows[0],
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
  validate(UpdateSchoolTeacherSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { id } = req.params;
    const { name, email, password, subject_id, is_active } = req.body;

    const existing = await pool.query(
      `SELECT id, email FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) {
      throw new HttpError(404, 'Teacher not found');
    }

    if (email && email !== existing.rows[0].email) {
      const emailTaken = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [
        email,
        id,
      ]);
      if (emailTaken.rowCount) {
        throw new HttpError(409, 'Email is already registered');
      }
    }

    if (subject_id !== undefined) {
      await assertSchoolSubject(schoolId, subject_id);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updates: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if (name !== undefined) {
        updates.push(`name = $${i++}`);
        values.push(name);
      }
      if (email !== undefined) {
        updates.push(`email = $${i++}`);
        values.push(email);
      }
      if (password) {
        const hashed = await bcrypt.hash(password, 10);
        updates.push(`password = $${i++}`);
        values.push(hashed);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${i++}`);
        values.push(is_active);
      }

      if (updates.length) {
        values.push(id, schoolId);
        const updated = await client.query(
          `UPDATE users
           SET ${updates.join(', ')}
           WHERE id = $${i} AND school_id = $${i + 1} AND role = 'teacher' AND deleted_at IS NULL`,
          values,
        );
        if (!updated.rowCount) {
          throw new HttpError(404, 'Teacher not found');
        }
      }

      if (subject_id !== undefined) {
        await client.query(
          `UPDATE teacher_subjects SET subject_id = $1 WHERE user_id = $2`,
          [subject_id, id],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const result = await pool.query(
      `${TEACHER_SELECT}
       WHERE u.id = $1 AND u.school_id = $2`,
      [id, schoolId],
    );

    res.json({
      message: 'Teacher updated successfully',
      teacher: result.rows[0],
    });
  }),
);

router.delete(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE users
       SET is_active = FALSE, deleted_at = NOW()
       WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND deleted_at IS NULL
       RETURNING id, name, email`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Teacher not found or already deleted');
    }

    res.json({
      message: 'Teacher deactivated successfully',
      teacher: result.rows[0],
    });
  }),
);
