import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError, upload, uploadToCloudinary } from '../utils';
import bcrypt from 'bcrypt';
import pool from '../db/pool';
import { z } from 'zod';

export const router = Router();

export const CreateTeacherSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  password: z.string().min(6),
  grade_ids: z.array(z.number()).optional(),
});

export const UpdateTeacherSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  password: z.string().min(6).optional(),
  grade_ids: z.array(z.number()).optional(),
});
router.post(
  '/',
  authMiddleware(['admin']),
  upload.single('avatar'),
  validate(CreateTeacherSchema),
  asyncWrapper(async (req, res) => {
    const { email, phone, password, name, grade_ids } = req.body;

    if (!email && !phone) {
      throw new HttpError(400, 'Email or phone must be provided');
    }

    const existing = await pool.query(
      `SELECT id FROM users WHERE (email = $1 AND $1 IS NOT NULL) OR (phone = $2 AND $2 IS NOT NULL)`,
      [email, phone],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new HttpError(409, 'A teacher with this email or phone already exists');
    }

    const file = req.file ?? null;
    const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;
    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, phone, password, name, role, avatar)
       VALUES ($1, $2, $3, $4, 'teacher', $5)
       RETURNING id`,
      [email, phone, hashed, name, avatar],
    );

    const teacherId = result.rows[0].id;

    if (grade_ids?.length) {
      const values = grade_ids.map((gradeId: number) => `(${teacherId}, ${gradeId})`).join(', ');
      await pool.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ${values}`);
    }

    res.status(201).json({ message: 'Teacher created successfully', teacherId });
  }),
);

router.put(
  '/:id',
  authMiddleware(['admin']),
  upload.single('avatar'),
  validate(UpdateTeacherSchema),
  asyncWrapper(async (req, res) => {
    const { name, email, phone, password, grade_ids } = req.body;
    const { id } = req.params;

    const file = req.file ?? null;
    const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (name) {
      updates.push(`name = $${i++}`);
      values.push(name);
    }
    if (email) {
      updates.push(`email = $${i++}`);
      values.push(email);
    }
    if (phone) {
      updates.push(`phone = $${i++}`);
      values.push(phone);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${i++}`);
      values.push(hashed);
    }
    if (avatar) {
      updates.push(`avatar = $${i++}`);
      values.push(avatar);
    }

    if (updates.length) {
      values.push(id);
      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} AND role = 'teacher'`,
        values,
      );

      if (result.rowCount === 0) {
        throw new HttpError(404, 'Teacher not found or invalid role');
      }
    }

    if (grade_ids) {
      await pool.query('DELETE FROM user_grades WHERE user_id = $1', [id]);
      if (grade_ids.length) {
        const values = grade_ids.map((gradeId: number) => `(${id}, ${gradeId})`).join(', ');
        await pool.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ${values}`);
      }
    }

    res.status(200).json({ message: 'Teacher updated successfully' });
  }),
);
