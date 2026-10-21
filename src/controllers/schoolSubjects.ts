import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CreateSchoolSubjectSchema,
  ReorderSchoolSubjectsSchema,
  UpdateSchoolSubjectSchema,
} from './schoolSubjects.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

async function assertSchoolGrades(schoolId: number, gradeIds: number[]) {
  if (!gradeIds.length) return;

  const result = await pool.query(
    `SELECT id FROM grades
     WHERE school_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])`,
    [schoolId, gradeIds],
  );

  if (result.rowCount !== gradeIds.length) {
    throw new HttpError(404, 'One or more grades were not found in your school');
  }
}

async function syncSubjectGrades(
  client: { query: typeof pool.query },
  subjectId: number,
  gradeIds: number[],
) {
  await client.query('DELETE FROM subject_grades WHERE subject_id = $1', [subjectId]);
  if (!gradeIds.length) return;

  const values: unknown[] = [];
  const placeholders = gradeIds.map((gradeId, idx) => {
    values.push(subjectId, gradeId);
    const base = idx * 2;
    return `($${base + 1}, $${base + 2})`;
  });

  await client.query(
    `INSERT INTO subject_grades (subject_id, grade_id) VALUES ${placeholders.join(', ')}`,
    values,
  );
}

const SUBJECT_SELECT = `
  SELECT
    s.id,
    s.school_id,
    s.name,
    s.code,
    s.description,
    s.is_active,
    s.position,
    s.created_at,
    s.deleted_at,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object('id', g.id, 'name', g.name)
          ORDER BY g.position ASC, g.id ASC
        )
        FROM subject_grades sg
        JOIN grades g ON g.id = sg.grade_id
        WHERE sg.subject_id = s.id AND g.deleted_at IS NULL
      ),
      '[]'::json
    ) AS grades
  FROM subjects s
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
    const conditions = ['s.school_id = $1'];
    let i = 2;

    if (include_deleted !== 'true') {
      conditions.push('s.deleted_at IS NULL');
    }

    if (is_active === 'true' || is_active === 'false') {
      conditions.push(`s.is_active = $${i++}`);
      values.push(is_active === 'true');
    }

    if (grade_id) {
      const gradeIdNum = Number(grade_id);
      if (!Number.isInteger(gradeIdNum) || gradeIdNum <= 0) {
        throw new HttpError(400, 'Invalid grade_id');
      }
      await assertSchoolGrades(schoolId, [gradeIdNum]);
      conditions.push(`EXISTS (
        SELECT 1 FROM subject_grades sg
        WHERE sg.subject_id = s.id AND sg.grade_id = $${i++}
      )`);
      values.push(gradeIdNum);
    }

    const q = search.trim();
    if (q) {
      conditions.push(
        `(s.name ILIKE $${i} OR COALESCE(s.code, '') ILIKE $${i} OR COALESCE(s.description, '') ILIKE $${i})`,
      );
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM subjects s ${whereSQL}`,
      values,
    );

    const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);
    values.push(limitNum, skipNum);

    const result = await pool.query(
      `${SUBJECT_SELECT}
       ${whereSQL}
       ORDER BY s.position ASC, s.id ASC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      subjects: result.rows,
      total: countResult.rows[0].total,
      limit: limitNum,
      skip: skipNum,
    });
  }),
);

router.post(
  '/',
  authMiddleware(['school_admin']),
  validate(CreateSchoolSubjectSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { name, code, description, position, is_active, grade_ids = [] } = req.body;

    await assertSchoolGrades(schoolId, grade_ids);

    const duplicateName = await pool.query(
      `SELECT id FROM subjects
       WHERE school_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [schoolId, name],
    );
    if (duplicateName.rowCount) {
      throw new HttpError(409, 'A subject with this name already exists in your school');
    }

    if (code) {
      const duplicateCode = await pool.query(
        `SELECT id FROM subjects
         WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL`,
        [schoolId, code],
      );
      if (duplicateCode.rowCount) {
        throw new HttpError(409, 'A subject with this code already exists in your school');
      }
    }

    let nextPosition = position;
    if (nextPosition === undefined) {
      const maxPos = await pool.query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
         FROM subjects
         WHERE school_id = $1 AND deleted_at IS NULL`,
        [schoolId],
      );
      nextPosition = maxPos.rows[0].next_position;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `INSERT INTO subjects (school_id, name, code, description, position, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [schoolId, name, code ?? null, description ?? null, nextPosition, is_active ?? true],
      );

      const subjectId = inserted.rows[0].id;
      await syncSubjectGrades(client, subjectId, grade_ids);

      await client.query('COMMIT');

      const result = await pool.query(`${SUBJECT_SELECT} WHERE s.id = $1`, [subjectId]);

      res.status(201).json({
        message: 'Subject created successfully',
        subject: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }),
);

router.patch(
  '/reorder',
  authMiddleware(['school_admin']),
  validate(ReorderSchoolSubjectsSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { items } = req.body as { items: { id: number; position: number }[] };

    const ids = items.map((item) => item.id);
    const owned = await pool.query(
      `SELECT id FROM subjects
       WHERE school_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])`,
      [schoolId, ids],
    );

    if (owned.rowCount !== ids.length) {
      throw new HttpError(404, 'One or more subjects were not found in your school');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          `UPDATE subjects
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
      `${SUBJECT_SELECT}
       WHERE s.school_id = $1 AND s.deleted_at IS NULL AND s.id = ANY($2::int[])
       ORDER BY s.position ASC, s.id ASC`,
      [schoolId, ids],
    );

    res.json({
      message: 'Subjects reordered successfully',
      subjects: result.rows,
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
      `${SUBJECT_SELECT}
       WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Subject not found');
    }

    res.json({ subject: result.rows[0] });
  }),
);

router.put(
  '/:id',
  authMiddleware(['school_admin']),
  validate(UpdateSchoolSubjectSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { id } = req.params;
    const { name, code, description, position, is_active, grade_ids } = req.body;

    const existing = await pool.query(
      `SELECT id, name, code FROM subjects
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) {
      throw new HttpError(404, 'Subject not found');
    }

    const current = existing.rows[0];

    if (name && name !== current.name) {
      const duplicateName = await pool.query(
        `SELECT id FROM subjects
         WHERE school_id = $1 AND name = $2 AND deleted_at IS NULL AND id <> $3`,
        [schoolId, name, id],
      );
      if (duplicateName.rowCount) {
        throw new HttpError(409, 'A subject with this name already exists in your school');
      }
    }

    const nextCode = code === undefined ? current.code : code === '' || code === null ? null : code;
    if (nextCode && nextCode !== current.code) {
      const duplicateCode = await pool.query(
        `SELECT id FROM subjects
         WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL AND id <> $3`,
        [schoolId, nextCode, id],
      );
      if (duplicateCode.rowCount) {
        throw new HttpError(409, 'A subject with this code already exists in your school');
      }
    }

    if (grade_ids !== undefined) {
      await assertSchoolGrades(schoolId, grade_ids);
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
      if (code !== undefined) {
        updates.push(`code = $${i++}`);
        values.push(nextCode);
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

      if (updates.length) {
        values.push(id, schoolId);
        await client.query(
          `UPDATE subjects
           SET ${updates.join(', ')}
           WHERE id = $${i} AND school_id = $${i + 1} AND deleted_at IS NULL`,
          values,
        );
      }

      if (grade_ids !== undefined) {
        await syncSubjectGrades(client, Number(id), grade_ids);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const result = await pool.query(
      `${SUBJECT_SELECT}
       WHERE s.id = $1 AND s.school_id = $2`,
      [id, schoolId],
    );

    res.json({
      message: 'Subject updated successfully',
      subject: result.rows[0],
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
        `DELETE FROM subjects
         WHERE id = $1 AND school_id = $2
         RETURNING id, name`,
        [id, schoolId],
      );
      if (!result.rowCount) {
        throw new HttpError(404, 'Subject not found');
      }

      return res.json({
        message: 'Subject permanently deleted',
        subject: result.rows[0],
      });
    }

    const result = await pool.query(
      `UPDATE subjects
       SET is_active = FALSE, deleted_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       RETURNING id, name`,
      [id, schoolId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Subject not found or already deleted');
    }

    res.json({
      message: 'Subject deactivated successfully',
      subject: result.rows[0],
    });
  }),
);
