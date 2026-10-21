import { Router } from 'express';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';

export const router = Router();

router.get(
  '/grades',
  asyncWrapper(async (_req, res) => {
    const result = await pool.query('SELECT id, name FROM grades ORDER BY id');
    res.status(200).json({ grades: result.rows });
  }),
);

router.get('/health-check', async (req, res) => {
  res.send('Healthy!');
});
