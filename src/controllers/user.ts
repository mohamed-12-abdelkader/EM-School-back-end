import pool from '../db/pool';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { validate } from '../middleware/validateReq';
import { authMiddleware } from '../middleware/authentication';
import { Router } from 'express';
import { ChangePassword, RegisterStudent } from './auth.modules';
import { asyncWrapper, generateToken } from '../utils';

const UpdateMe = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  name: z.string().optional(),
});

export const router = Router();

router.post(
  '/register',
  validate(RegisterStudent),
  asyncWrapper(async (req, res) => {
    const { phone, password, name, grade_id } = req.body;

    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.rowCount)
      return res.status(400).json({ message: 'Phone number already registered' });

    const gradeCheck = await pool.query('SELECT id FROM grades WHERE id = $1', [grade_id]);
    if (!gradeCheck.rowCount) return res.status(400).json({ message: 'Invalid grade selected' });

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (phone, password, name, role)
       VALUES ($1, $2, $3, 'student')
       RETURNING id, phone, name, role`,
      [phone, hashed, name],
    );

    const user = result.rows[0];

    await pool.query('INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)', [
      user.id,
      grade_id,
    ]);

    user.grade_id = grade_id;

    const token = await generateToken(user, pool);
    res.status(201).json({ user, token });
  }),
);

router.post(
  '/change-password',
  authMiddleware(['admin']),
  validate(ChangePassword),
  asyncWrapper(async (req, res) => {
    const { email, phone, new_password } = req.body;

    // Identify the user
    const query = email ? { field: 'email', value: email } : { field: 'phone', value: phone };

    const userResult = await pool.query(`SELECT id FROM users WHERE ${query.field} = $1`, [
      query.value,
    ]);

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userId = userResult.rows[0].id;
    const hashedPassword = await bcrypt.hash(new_password, 10);

    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

    res.status(200).json({ message: 'Password updated successfully' });
  }),
);

router.get('/me', authMiddleware(), async (req, res) => {
  res.json({ user: (req as any).user });
});

router.put('/me', authMiddleware(), validate(UpdateMe), async (req, res) => {
  const { email, password, name } = req.body;
  const userId = (req as any).user.id;

  if (email) await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, userId]);
  if (name) await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
  if (password) {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
  }

  const updated = await pool.query(
    'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
    [userId],
  );

  res.json({ user: updated.rows[0] });
});

/**
 * @example
 * - Get first 10 teachers: GET /admin/users?role=teacher&limit=10&skip=0
 * - Get students in grade 5: GET /admin/users?role=student&grade_ids=5
 * - Get all users in grade 3 or 7: GET /admin/users?grade_ids=3,7
 */
router.get(
  '/',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const {
      limit = 10,
      skip = 0,
      role,
      grade_ids,
    } = req.query as {
      limit?: string;
      skip?: string;
      role?: string;
      grade_ids?: string;
    };

    const values: any[] = [];
    let whereClause = '';
    let joinClause = '';
    let counter = 1;

    // Filter by role
    if (role) {
      whereClause += `users.role = $${counter}`;
      values.push(role);
      counter++;
    }

    // Filter by grades (join user_grades)
    if (grade_ids) {
      const ids = grade_ids
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter(Boolean);
      if (ids.length > 0) {
        if (whereClause) whereClause += ' AND ';
        joinClause = `
          JOIN user_grades ug ON users.id = ug.user_id
        `;
        whereClause += `ug.grade_id = ANY($${counter})`;
        values.push(ids);
        counter++;
      }
    }

    const whereSQL = whereClause ? `WHERE ${whereClause}` : '';
    const limitSQL = `LIMIT $${counter}`;
    const offsetSQL = `OFFSET $${counter + 1}`;
    values.push(Number(limit));
    values.push(Number(skip));

    const query = `
      SELECT DISTINCT users.id, users.name, users.email, users.phone, users.role, users.avatar, users.created_at
      FROM users
      ${joinClause}
      ${whereSQL}
      ORDER BY users.created_at DESC
      ${limitSQL}
      ${offsetSQL}
    `;

    const result = await pool.query(query, values);
    res.json({ users: result.rows });
  }),
);
