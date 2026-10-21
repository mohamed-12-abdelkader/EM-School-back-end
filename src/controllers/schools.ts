import { Router } from 'express';
import bcrypt from 'bcrypt';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError, upload, uploadToCloudinary } from '../utils';
import pool from '../db/pool';
import { CreateSchoolSchema, UpdateSchoolSchema } from './schools.modules';

export const router = Router();

const SCHOOL_SELECT = `
  SELECT
    s.id,
    s.name,
    s.logo,
    s.description,
    s.is_active,
    s.created_at,
    s.deleted_at,
    s.login_code,
    u.id AS admin_user_id,
    u.email AS email
  FROM schools s
  LEFT JOIN users u ON u.school_id = s.id AND u.role = 'school_admin'
`;

router.get(
  '/',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const {
      limit = '10',
      skip = '0',
      search = '',
      include_deleted = 'false',
    } = req.query as {
      limit?: string;
      skip?: string;
      search?: string;
      include_deleted?: string;
    };

    const values: unknown[] = [];
    const conditions: string[] = [];
    let i = 1;

    if (include_deleted !== 'true') {
      conditions.push('s.deleted_at IS NULL');
    }

    const q = search.trim();
    if (q) {
      conditions.push(`(s.name ILIKE $${i} OR u.email ILIKE $${i})`);
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM schools s
       LEFT JOIN users u ON u.school_id = s.id AND u.role = 'school_admin'
       ${whereSQL}`,
      values,
    );

    const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const skipNum = Math.max(Number(skip) || 0, 0);

    values.push(limitNum);
    values.push(skipNum);

    const result = await pool.query(
      `${SCHOOL_SELECT}
       ${whereSQL}
       ORDER BY s.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    res.json({
      schools: result.rows,
      total: countResult.rows[0].total,
      limit: limitNum,
      skip: skipNum,
    });
  }),
);

router.get(
  '/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const { id } = req.params;

    const result = await pool.query(`${SCHOOL_SELECT} WHERE s.id = $1 AND s.deleted_at IS NULL`, [
      id,
    ]);

    if (!result.rowCount) {
      throw new HttpError(404, 'School not found');
    }

    res.json({ school: result.rows[0] });
  }),
);

router.post(
  '/',
  authMiddleware(['admin']),
  upload.single('logo'),
  validate(CreateSchoolSchema),
  asyncWrapper(async (req, res) => {
    const { name, description, email, password } = req.body;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) {
      throw new HttpError(409, 'Email is already registered');
    }

    const file = req.file ?? null;
    const logo = file ? (await uploadToCloudinary(file.path)).secure_url : null;
    const hashed = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const schoolResult = await client.query(
        `INSERT INTO schools (name, logo, description, login_code)
         VALUES ($1, $2, $3, UPPER(SUBSTR(MD5(RANDOM()::TEXT || clock_timestamp()::TEXT), 1, 6)))
         RETURNING id, name, logo, description, is_active, created_at, deleted_at, login_code`,
        [name, logo, description ?? null],
      );
      const school = schoolResult.rows[0];

      const userResult = await client.query(
        `INSERT INTO users (email, password, name, role, school_id)
         VALUES ($1, $2, $3, 'school_admin', $4)
         RETURNING id, email`,
        [email, hashed, name, school.id],
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'School created successfully',
        school: {
          ...school,
          admin_user_id: userResult.rows[0].id,
          email: userResult.rows[0].email,
        },
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
  authMiddleware(['admin']),
  upload.single('logo'),
  validate(UpdateSchoolSchema),
  asyncWrapper(async (req, res) => {
    const { id } = req.params;
    const { name, description, email, password, is_active } = req.body;

    const schoolCheck = await pool.query(
      'SELECT id FROM schools WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!schoolCheck.rowCount) {
      throw new HttpError(404, 'School not found');
    }

    const adminResult = await pool.query(
      `SELECT id, email FROM users WHERE school_id = $1 AND role = 'school_admin'`,
      [id],
    );
    if (!adminResult.rowCount) {
      throw new HttpError(404, 'School admin account not found');
    }
    const admin = adminResult.rows[0];

    if (email && email !== admin.email) {
      const emailTaken = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [email, admin.id],
      );
      if (emailTaken.rowCount) {
        throw new HttpError(409, 'Email is already registered');
      }
    }

    const file = req.file ?? null;
    const logo = file ? (await uploadToCloudinary(file.path)).secure_url : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const schoolUpdates: string[] = [];
      const schoolValues: unknown[] = [];
      let i = 1;

      if (name !== undefined) {
        schoolUpdates.push(`name = $${i++}`);
        schoolValues.push(name);
      }
      if (description !== undefined) {
        schoolUpdates.push(`description = $${i++}`);
        schoolValues.push(description === '' ? null : description);
      }
      if (logo) {
        schoolUpdates.push(`logo = $${i++}`);
        schoolValues.push(logo);
      }
      if (is_active !== undefined) {
        schoolUpdates.push(`is_active = $${i++}`);
        schoolValues.push(is_active);
      }

      if (schoolUpdates.length) {
        schoolValues.push(id);
        await client.query(
          `UPDATE schools SET ${schoolUpdates.join(', ')} WHERE id = $${i} AND deleted_at IS NULL`,
          schoolValues,
        );
      }

      const userUpdates: string[] = [];
      const userValues: unknown[] = [];
      let j = 1;

      if (name !== undefined) {
        userUpdates.push(`name = $${j++}`);
        userValues.push(name);
      }
      if (email !== undefined) {
        userUpdates.push(`email = $${j++}`);
        userValues.push(email);
      }
      if (password) {
        const hashed = await bcrypt.hash(password, 10);
        userUpdates.push(`password = $${j++}`);
        userValues.push(hashed);
      }

      if (userUpdates.length) {
        userValues.push(admin.id);
        await client.query(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = $${j}`, userValues);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const updated = await pool.query(`${SCHOOL_SELECT} WHERE s.id = $1`, [id]);

    res.json({
      message: 'School updated successfully',
      school: updated.rows[0],
    });
  }),
);

router.delete(
  '/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE schools
       SET is_active = FALSE, deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, name`,
      [id],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'School not found or already deleted');
    }

    // Soft-disable school without cascading related academic data
    res.json({
      message: 'School deactivated successfully',
      school: result.rows[0],
    });
  }),
);
