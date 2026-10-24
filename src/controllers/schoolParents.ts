import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import { allocateUniqueParentLoginCode } from '../services/accessCodes';
import { UpdateSchoolParentSchema } from './schoolParents.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

const PARENT_SELECT = `
  SELECT
    u.id,
    u.school_id,
    u.name,
    u.email,
    u.phone,
    u.login_code,
    u.is_active,
    u.created_at,
    u.deleted_at,
    pp.national_id,
    pp.secondary_phone,
    pp.address,
    pp.notes,
    pp.updated_at AS profile_updated_at,
    (
      SELECT COUNT(*)::int FROM parent_students ps
      JOIN users s ON s.id = ps.student_id
      WHERE ps.parent_id = u.id AND s.deleted_at IS NULL
    ) AS students_count
  FROM users u
  LEFT JOIN parent_profiles pp ON pp.user_id = u.id
`;

router.get(
  '/',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const {
      limit = '20',
      skip = '0',
      search = '',
      include_deleted = 'false',
    } = req.query as Record<string, string | undefined>;

    const values: unknown[] = [schoolId];
    const conditions = ["u.role = 'parent'", 'u.school_id = $1'];
    let i = 2;

    if (include_deleted !== 'true') conditions.push('u.deleted_at IS NULL');

    const q = (search || '').trim();
    if (q) {
      conditions.push(
        `(u.name ILIKE $${i} OR COALESCE(u.phone,'') ILIKE $${i} OR COALESCE(u.login_code,'') ILIKE $${i} OR COALESCE(u.email,'') ILIKE $${i})`,
      );
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereSQL}`,
      values,
    );

    values.push(limitNum, skipNum);
    const rows = await pool.query(
      `${PARENT_SELECT}
       ${whereSQL}
       ORDER BY u.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      parents: rows.rows,
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
    const result = await pool.query(
      `${PARENT_SELECT}
       WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'parent' AND u.deleted_at IS NULL`,
      [req.params.id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Parent not found');

    const students = await pool.query(
      `SELECT
         s.id, s.name, s.login_code, s.phone, s.email,
         sp.grade_id, g.name AS grade_name,
         sp.classroom_id, c.name AS classroom_name,
         sp.academic_year, sp.status,
         ps.relation, ps.is_primary
       FROM parent_students ps
       JOIN users s ON s.id = ps.student_id
       JOIN student_profiles sp ON sp.user_id = s.id
       JOIN grades g ON g.id = sp.grade_id
       JOIN classrooms c ON c.id = sp.classroom_id
       WHERE ps.parent_id = $1 AND s.deleted_at IS NULL
       ORDER BY s.name ASC`,
      [req.params.id],
    );

    res.json({ parent: result.rows[0], students: students.rows });
  }),
);

router.put(
  '/:id',
  authMiddleware(['school_admin']),
  validate(UpdateSchoolParentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    const body = req.body;

    const existing = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'parent' AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Parent not found');

    if (body.phone) {
      const dup = await pool.query(
        `SELECT id FROM users
         WHERE phone = $1 AND id <> $2 AND deleted_at IS NULL`,
        [body.phone, id],
      );
      if (dup.rowCount) throw new HttpError(409, 'Phone number already registered');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userUpdates: string[] = [];
      const userValues: unknown[] = [];
      let i = 1;
      if (body.name !== undefined) {
        userUpdates.push(`name = $${i++}`);
        userValues.push(body.name);
      }
      if (body.phone !== undefined) {
        userUpdates.push(`phone = $${i++}`);
        userValues.push(body.phone);
      }
      if (body.email !== undefined) {
        userUpdates.push(`email = $${i++}`);
        userValues.push(body.email);
      }
      if (body.is_active !== undefined) {
        userUpdates.push(`is_active = $${i++}`);
        userValues.push(body.is_active);
      }
      if (userUpdates.length) {
        userValues.push(id);
        await client.query(
          `UPDATE users SET ${userUpdates.join(', ')} WHERE id = $${i}`,
          userValues,
        );
      }

      await client.query(
        `INSERT INTO parent_profiles (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [id],
      );

      const profileUpdates: string[] = [];
      const profileValues: unknown[] = [];
      let j = 1;
      for (const [col, val] of [
        ['national_id', body.national_id],
        ['secondary_phone', body.secondary_phone],
        ['address', body.address],
        ['notes', body.notes],
      ] as Array<[string, unknown]>) {
        if (val !== undefined) {
          profileUpdates.push(`${col} = $${j++}`);
          profileValues.push(val);
        }
      }
      if (profileUpdates.length) {
        profileUpdates.push('updated_at = NOW()');
        profileValues.push(id);
        await client.query(
          `UPDATE parent_profiles SET ${profileUpdates.join(', ')} WHERE user_id = $${j}`,
          profileValues,
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const parent = (
      await pool.query(`${PARENT_SELECT} WHERE u.id = $1`, [id])
    ).rows[0];
    res.json({ message: 'Parent updated successfully', parent });
  }),
);

router.post(
  '/:id/regenerate-login-code',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);

    const existing = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'parent' AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Parent not found');

    const code = await allocateUniqueParentLoginCode();
    await pool.query(`UPDATE users SET login_code = $1 WHERE id = $2`, [code, id]);

    res.json({
      message: 'Parent login code regenerated',
      login_code: code,
    });
  }),
);

router.delete(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);

    const linked = await pool.query(
      `SELECT 1 FROM parent_students ps
       JOIN users s ON s.id = ps.student_id
       WHERE ps.parent_id = $1 AND s.deleted_at IS NULL
       LIMIT 1`,
      [id],
    );
    if (linked.rowCount) {
      throw new HttpError(
        409,
        'Cannot deactivate a parent still linked to active students. Unlink or archive students first, or set is_active=false via update.',
      );
    }

    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW(), is_active = FALSE
       WHERE id = $1 AND school_id = $2 AND role = 'parent' AND deleted_at IS NULL
       RETURNING id, name`,
      [id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Parent not found or already deleted');

    res.json({ message: 'Parent deactivated successfully', parent: result.rows[0] });
  }),
);
