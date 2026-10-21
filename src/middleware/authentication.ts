import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../utils';
import pool from '../db/pool';
import { User } from '../db/types';

type Roles = 'student' | 'teacher' | 'admin' | 'school_admin' | 'parent';

export function authMiddleware(roles: Roles[] = []): RequestHandler {
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
      const decoded = jwt.verify(token, config.SECRET_KEY) as any;
      const { id, jti } = decoded;

      // Fetch user from DB
      const result = await pool.query<User>(
        'SELECT id, role, jti, school_id, email, name FROM users WHERE id = $1',
        [id],
      );
      if (!result.rowCount) return res.status(401).json({ message: 'User not found' });

      const user = result.rows[0];

      // Role-based access check
      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ message: 'Forbidden: insufficient role' });
      }

      // School admins cannot access other schools' data via role alone;
      // school-scoped routes must also enforce req.user.school_id.
      if (user.role === 'school_admin' && user.school_id) {
        const school = await pool.query(
          'SELECT id FROM schools WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE',
          [user.school_id],
        );
        if (!school.rowCount) {
          return res.status(403).json({ message: 'School account is inactive' });
        }
      }

      // JTI check for students only
      if (user.role === 'student' && user.jti !== jti) {
        return res.status(401).json({ message: 'Session expired or replaced' });
      }

      req.user = user;
      next();
    } catch {
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}
