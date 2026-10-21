import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CreateSchoolGradeSchema,
  ReorderSchoolGradesSchema,
  UpdateSchoolGradeSchema,
} from './schoolGrades.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

const GRADE_SELECT = `
  SELECT
    id,
    school_id,
    name,
    description,
    is_active,
    position,
    created_at,
    deleted_at
  FROM grades
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
      is_active,
      include_deleted = 'false',
    } = req.query as {
      limit?: string;
      skip?: string;
      search?: string;
      is_active?: string;
      include_deleted?: string;
    };

    const values: unknown[] = [schoolId];
    const conditions = ['school_id = $1'];
    let i = 2;

    if (include_deleted !== 'true') {
      conditions.push('deleted_at IS NULL');
    }

    if (is_active === 'true' || is_active === 'false') {
      conditions.push(`is_active = $${i++}`);
      values.push(is_active === 'true');
    }

    const q = search.trim();
    if (q) {
      conditions.push(`(name ILIKE $${i} OR COALESCE(description, '') ILIKE $${i})`);
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM grades ${whereSQL}`,
      values,
    );

    const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);

    values.push(limitNum, skipNum);

    const result = await pool.query(
      `${GRADE_SELECT}
       ${whereSQL}
       ORDER BY position ASC, id ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      grades: result.rows,
      total: countResult.rows[0].total,
      limit: limitNum,
      skip: skipNum,
    });
  }),
);

router.post(
  '/',
  authMiddleware(['school_admin']),
  validate(CreateSchoolGradeSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { name, description, position, is_active } = req.body;

    const duplicate = await pool.query(
      `SELECT id FROM grades
       WHERE school_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [schoolId, name],
    );
    if (duplicate.rowCount) {
      throw new HttpError(409, 'A grade with this name already exists in your school');
    }

    let nextPosition = position;
    if (nextPosition === undefined) {
      const maxPos = await pool.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
         FROM grades
         WHERE school_id = $1 AND deleted_at IS NULL`,
        [schoolId],
      );
      nextPosition = maxPos.rows[0].next_position;
    }

    const result = await pool.query(
      `INSERT INTO grades (name, description, school_id, position, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, school_id, name, description, is_active, position, created_at, deleted_at`,
      [name, description ?? null, schoolId, nextPosition, is_active ?? true],
    );

    res.status(201).json({
      message: 'Grade created successfully',
      grade: result.rows[0],
    });
  }),
);

router.patch(
  '/reorder',
  authMiddleware(['school_admin']),
  validate(ReorderSchoolGradesSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { items } = req.body as { items: { id: number; position: number }[] };

    const ids = items.map((item) => item.id);
    const owned = await pool.query(
      `SELECT id FROM grades
       WHERE school_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])`,
      [schoolId, ids],
    );

    if (owned.rowCount !== ids.length) {
      throw new HttpError(404, 'One or more grades were not found in your school');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          `UPDATE grades
           SET position = $1
           WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL`,
          [item.position, item.id, schoolId],
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
      `${GRADE_SELECT}
       WHERE school_id = $1 AND deleted_at IS NULL
       ORDER BY position ASC, id ASC`,
      [schoolId],
    );

    res.json({
      message: 'Grades reordered successfully',
      grades: result.rows,
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
      `${GRADE_SELECT}
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Grade not found');
    }

    res.json({ grade: result.rows[0] });
  }),
);

router.put(
  '/:id',
  authMiddleware(['school_admin']),
  validate(UpdateSchoolGradeSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { id } = req.params;
    const { name, description, position, is_active } = req.body;

    const existing = await pool.query(
      `SELECT id, name FROM grades
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) {
      throw new HttpError(404, 'Grade not found');
    }

    if (name && name !== existing.rows[0].name) {
      const duplicate = await pool.query(
        `SELECT id FROM grades
         WHERE school_id = $1 AND name = $2 AND deleted_at IS NULL AND id <> $3`,
        [schoolId, name, id],
      );
      if (duplicate.rowCount) {
        throw new HttpError(409, 'A grade with this name already exists in your school');
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description === '' ? null : description);
    }
    if (position !== undefined) {
      updates.push(`position = $${i++}`);
      values.push(position);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${i++}`);
      values.push(is_active);
    }

    values.push(id, schoolId);

    const result = await pool.query(
      `UPDATE grades
       SET ${updates.join(', ')}
       WHERE id = $${i} AND school_id = $${i + 1} AND deleted_at IS NULL
       RETURNING id, school_id, name, description, is_active, position, created_at, deleted_at`,
      values,
    );

    res.json({
      message: 'Grade updated successfully',
      grade: result.rows[0],
    });
  }),
);

router.delete(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { id } = req.params;
    const hard = String(req.query.hard || 'false') === 'true';

    if (hard) {
      const linked = await pool.query(
        `SELECT 1 FROM user_grades ug
         JOIN grades g ON g.id = ug.grade_id
         WHERE g.id = $1 AND g.school_id = $2
         LIMIT 1`,
        [id, schoolId],
      );
      if (linked.rowCount) {
        throw new HttpError(
          409,
          'Cannot permanently delete a grade that has linked students or teachers. Deactivate or soft-delete instead.',
        );
      }

      const result = await pool.query(
        `DELETE FROM grades
         WHERE id = $1 AND school_id = $2
         RETURNING id, name`,
        [id, schoolId],
      );
      if (!result.rowCount) {
        throw new HttpError(404, 'Grade not found');
      }

      return res.json({
        message: 'Grade permanently deleted',
        grade: result.rows[0],
      });
    }

    const result = await pool.query(
      `UPDATE grades
       SET is_active = FALSE, deleted_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       RETURNING id, name`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Grade not found or already deleted');
    }

    res.json({
      message: 'Grade deactivated successfully',
      grade: result.rows[0],
    });
  }),
);
