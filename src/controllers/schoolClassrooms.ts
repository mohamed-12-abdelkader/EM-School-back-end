import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CreateSchoolClassroomSchema,
  ReorderSchoolClassroomsSchema,
  UpdateSchoolClassroomSchema,
} from './schoolClassrooms.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

async function assertSchoolGrade(schoolId: number, gradeId: number) {
  const result = await pool.query(
    `SELECT id, name FROM grades
     WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
    [gradeId, schoolId],
  );
  if (!result.rowCount) {
    throw new HttpError(404, 'Grade not found in your school');
  }
  return result.rows[0];
}

const CLASSROOM_SELECT = `
  SELECT
    c.id,
    c.school_id,
    c.grade_id,
    g.name AS grade_name,
    c.name,
    c.description,
    c.capacity,
    c.is_active,
    c.position,
    c.created_at,
    c.deleted_at
  FROM classrooms c
  JOIN grades g ON g.id = c.grade_id
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
      grade_id,
      is_active,
      include_deleted = 'false',
    } = req.query as {
      limit?: string;
      skip?: string;
      search?: string;
      grade_id?: string;
      is_active?: string;
      include_deleted?: string;
    };

    const values: unknown[] = [schoolId];
    const conditions = ['c.school_id = $1'];
    let i = 2;

    if (include_deleted !== 'true') {
      conditions.push('c.deleted_at IS NULL');
    }

    if (grade_id) {
      const gradeIdNum = Number(grade_id);
      if (!Number.isInteger(gradeIdNum) || gradeIdNum <= 0) {
        throw new HttpError(400, 'Invalid grade_id');
      }
      await assertSchoolGrade(schoolId, gradeIdNum);
      conditions.push(`c.grade_id = $${i++}`);
      values.push(gradeIdNum);
    }

    if (is_active === 'true' || is_active === 'false') {
      conditions.push(`c.is_active = $${i++}`);
      values.push(is_active === 'true');
    }

    const q = search.trim();
    if (q) {
      conditions.push(
        `(c.name ILIKE $${i} OR COALESCE(c.description, '') ILIKE $${i} OR g.name ILIKE $${i})`,
      );
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM classrooms c
       JOIN grades g ON g.id = c.grade_id
       ${whereSQL}`,
      values,
    );

    const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);
    values.push(limitNum, skipNum);

    const result = await pool.query(
      `${CLASSROOM_SELECT}
       ${whereSQL}
       ORDER BY c.grade_id ASC, c.position ASC, c.id ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      classrooms: result.rows,
      total: countResult.rows[0].total,
      limit: limitNum,
      skip: skipNum,
    });
  }),
);

router.post(
  '/',
  authMiddleware(['school_admin']),
  validate(CreateSchoolClassroomSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { grade_id, name, description, capacity, position, is_active } = req.body;

    await assertSchoolGrade(schoolId, grade_id);

    const duplicate = await pool.query(
      `SELECT id FROM classrooms
       WHERE school_id = $1 AND grade_id = $2 AND name = $3 AND deleted_at IS NULL`,
      [schoolId, grade_id, name],
    );
    if (duplicate.rowCount) {
      throw new HttpError(409, 'A classroom with this name already exists in this grade');
    }

    let nextPosition = position;
    if (nextPosition === undefined) {
      const maxPos = await pool.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
         FROM classrooms
         WHERE school_id = $1 AND grade_id = $2 AND deleted_at IS NULL`,
        [schoolId, grade_id],
      );
      nextPosition = maxPos.rows[0].next_position;
    }

    const inserted = await pool.query(
      `INSERT INTO classrooms
         (school_id, grade_id, name, description, capacity, position, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        schoolId,
        grade_id,
        name,
        description ?? null,
        capacity ?? null,
        nextPosition,
        is_active ?? true,
      ],
    );

    const result = await pool.query(`${CLASSROOM_SELECT} WHERE c.id = $1`, [inserted.rows[0].id]);

    res.status(201).json({
      message: 'Classroom created successfully',
      classroom: result.rows[0],
    });
  }),
);

router.patch(
  '/reorder',
  authMiddleware(['school_admin']),
  validate(ReorderSchoolClassroomsSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { items } = req.body as { items: { id: number; position: number }[] };

    const ids = items.map((item) => item.id);
    const owned = await pool.query(
      `SELECT id FROM classrooms
       WHERE school_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])`,
      [schoolId, ids],
    );

    if (owned.rowCount !== ids.length) {
      throw new HttpError(404, 'One or more classrooms were not found in your school');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          `UPDATE classrooms
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
      `${CLASSROOM_SELECT}
       WHERE c.school_id = $1 AND c.deleted_at IS NULL AND c.id = ANY($2::int[])
       ORDER BY c.grade_id ASC, c.position ASC, c.id ASC`,
      [schoolId, ids],
    );

    res.json({
      message: 'Classrooms reordered successfully',
      classrooms: result.rows,
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
      `${CLASSROOM_SELECT}
       WHERE c.id = $1 AND c.school_id = $2 AND c.deleted_at IS NULL`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Classroom not found');
    }

    res.json({ classroom: result.rows[0] });
  }),
);

router.put(
  '/:id',
  authMiddleware(['school_admin']),
  validate(UpdateSchoolClassroomSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { id } = req.params;
    const { grade_id, name, description, capacity, position, is_active } = req.body;

    const existing = await pool.query(
      `SELECT id, grade_id, name FROM classrooms
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) {
      throw new HttpError(404, 'Classroom not found');
    }

    const current = existing.rows[0];
    const nextGradeId = grade_id ?? current.grade_id;
    const nextName = name ?? current.name;

    if (grade_id !== undefined) {
      await assertSchoolGrade(schoolId, grade_id);
    }

    if (nextName !== current.name || nextGradeId !== current.grade_id) {
      const duplicate = await pool.query(
        `SELECT id FROM classrooms
         WHERE school_id = $1 AND grade_id = $2 AND name = $3
           AND deleted_at IS NULL AND id <> $4`,
        [schoolId, nextGradeId, nextName, id],
      );
      if (duplicate.rowCount) {
        throw new HttpError(409, 'A classroom with this name already exists in this grade');
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (grade_id !== undefined) {
      updates.push(`grade_id = $${i++}`);
      values.push(grade_id);
    }
    if (name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description === '' ? null : description);
    }
    if (capacity !== undefined) {
      updates.push(`capacity = $${i++}`);
      values.push(capacity);
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
    await pool.query(
      `UPDATE classrooms
       SET ${updates.join(', ')}
       WHERE id = $${i} AND school_id = $${i + 1} AND deleted_at IS NULL`,
      values,
    );

    const result = await pool.query(
      `${CLASSROOM_SELECT}
       WHERE c.id = $1 AND c.school_id = $2`,
      [id, schoolId],
    );

    res.json({
      message: 'Classroom updated successfully',
      classroom: result.rows[0],
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
      const result = await pool.query(
        `DELETE FROM classrooms
         WHERE id = $1 AND school_id = $2
         RETURNING id, name, grade_id`,
        [id, schoolId],
      );
      if (!result.rowCount) {
        throw new HttpError(404, 'Classroom not found');
      }

      return res.json({
        message: 'Classroom permanently deleted',
        classroom: result.rows[0],
      });
    }

    const result = await pool.query(
      `UPDATE classrooms
       SET is_active = FALSE, deleted_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       RETURNING id, name, grade_id`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Classroom not found or already deleted');
    }

    res.json({
      message: 'Classroom deactivated successfully',
      classroom: result.rows[0],
    });
  }),
);
