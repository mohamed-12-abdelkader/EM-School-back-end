import pool from '../db/pool';

export const getAllUsers = async () => {
  const res = await pool.query('SELECT id, name, email FROM users');
  return res.rows;
};

export const getUserById = async (id: string) => {
  const res = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
  return res.rows[0];
};

export const createUser = async (name: string, email: string, passwordHash: string) => {
  const res = await pool.query(
    'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
    [name, email, passwordHash],
  );
  return res.rows[0];
};

export const findUserByEmail = async (email: string) => {
  const res = await pool.query('SELECT id, name, email, password FROM users WHERE email = $1', [
    email,
  ]);
  return res.rows[0];
};
