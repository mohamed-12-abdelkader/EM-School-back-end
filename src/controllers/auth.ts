import { Router } from 'express';
import pool from '../db/pool';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { asyncWrapper, config, generateToken, sendEmail } from '../utils';
import { validate } from '../middleware/validateReq';
import {
  ForgotPassword,
  Login,
  LoginByCode,
  LoginParentByCode,
  LoginStudentByCode,
  ResetPassword,
} from './auth.modules';

export const router = Router();

async function loginBySchoolAndCode(params: {
  schoolCode: string;
  loginCode: string;
  role: 'student' | 'parent';
  ip: string | null;
}) {
  const { schoolCode, loginCode, role, ip } = params;

  const schoolResult = await pool.query(
    `SELECT id, name, login_code, is_active, deleted_at
     FROM schools
     WHERE UPPER(login_code) = UPPER($1)`,
    [schoolCode],
  );

  if (
    !schoolResult.rowCount ||
    schoolResult.rows[0].deleted_at ||
    !schoolResult.rows[0].is_active
  ) {
    await pool.query(
      `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
       VALUES (NULL, $1, $2, FALSE)`,
      [loginCode, ip],
    );
    return { status: 400 as const, body: { message: 'Invalid credentials' } };
  }

  const school = schoolResult.rows[0];

  const attempts = await pool.query(
    `SELECT COUNT(*)::int AS failed
     FROM login_code_attempts
     WHERE school_id = $1
       AND ip_address = $2
       AND success = FALSE
       AND created_at > NOW() - INTERVAL '15 minutes'`,
    [school.id, ip],
  );
  if (attempts.rows[0].failed >= 20) {
    return {
      status: 429 as const,
      body: { message: 'Too many failed login attempts. Please try again later.' },
    };
  }

  const userQuery = await pool.query(
    `SELECT * FROM users
     WHERE school_id = $1
       AND login_code = $2
       AND role = $3
       AND deleted_at IS NULL`,
    [school.id, loginCode, role],
  );

  if (!userQuery.rowCount || userQuery.rows[0].is_active === false) {
    await pool.query(
      `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
       VALUES ($1, $2, $3, FALSE)`,
      [school.id, loginCode, ip],
    );
    return { status: 400 as const, body: { message: 'Invalid credentials' } };
  }

  const user = userQuery.rows[0];
  let studentProfile: Record<string, unknown> | null = null;

  if (role === 'student') {
    const profile = await pool.query(
      `SELECT
         sp.status, sp.academic_year, sp.grade_id, sp.classroom_id,
         sp.seat_number, sp.national_id,
         g.name AS grade_name, c.name AS classroom_name
       FROM student_profiles sp
       LEFT JOIN grades g ON g.id = sp.grade_id
       LEFT JOIN classrooms c ON c.id = sp.classroom_id
       WHERE sp.user_id = $1`,
      [user.id],
    );
    if (!profile.rowCount || profile.rows[0].status !== 'active') {
      return { status: 403 as const, body: { message: 'Student account is not active' } };
    }
    studentProfile = profile.rows[0];
  }

  await pool.query(
    `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
     VALUES ($1, $2, $3, TRUE)`,
    [school.id, loginCode, ip],
  );

  const token = await generateToken(user, pool);
  return {
    status: 200 as const,
    body: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        school_id: user.school_id,
        login_code: user.login_code,
        avatar: user.avatar,
      },
      school: {
        id: school.id,
        name: school.name,
        login_code: school.login_code,
      },
      ...(studentProfile
        ? {
            profile: {
              status: studentProfile.status,
              academic_year: studentProfile.academic_year,
              grade_id: studentProfile.grade_id,
              grade_name: studentProfile.grade_name,
              classroom_id: studentProfile.classroom_id,
              classroom_name: studentProfile.classroom_name,
              seat_number: studentProfile.seat_number,
            },
          }
        : {}),
      token,
    },
  };
}

/** Student login with student code only (globally unique). */
router.post(
  '/login/student',
  validate(LoginStudentByCode),
  asyncWrapper(async (req, res) => {
    const { login_code } = req.body;
    const ip = req.ip || req.socket.remoteAddress || null;

    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS failed
       FROM login_code_attempts
       WHERE ip_address = $1
         AND success = FALSE
         AND created_at > NOW() - INTERVAL '15 minutes'`,
      [ip],
    );
    if (attempts.rows[0].failed >= 20) {
      return res.status(429).json({
        message: 'Too many failed login attempts. Please try again later.',
      });
    }

    const userQuery = await pool.query(
      `SELECT u.*
       FROM users u
       WHERE u.login_code = $1
         AND u.role = 'student'
         AND u.deleted_at IS NULL`,
      [login_code],
    );

    if (!userQuery.rowCount || userQuery.rows[0].is_active === false) {
      await pool.query(
        `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
         VALUES (NULL, $1, $2, FALSE)`,
        [login_code, ip],
      );
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = userQuery.rows[0];

    const schoolResult = await pool.query(
      `SELECT id, name, login_code, is_active, deleted_at
       FROM schools WHERE id = $1`,
      [user.school_id],
    );
    if (
      !schoolResult.rowCount ||
      schoolResult.rows[0].deleted_at ||
      !schoolResult.rows[0].is_active
    ) {
      return res.status(403).json({ message: 'School account is inactive' });
    }
    const school = schoolResult.rows[0];

    const profile = await pool.query(
      `SELECT
         sp.status, sp.academic_year, sp.grade_id, sp.classroom_id,
         sp.seat_number,
         g.name AS grade_name, c.name AS classroom_name
       FROM student_profiles sp
       LEFT JOIN grades g ON g.id = sp.grade_id
       LEFT JOIN classrooms c ON c.id = sp.classroom_id
       WHERE sp.user_id = $1`,
      [user.id],
    );
    if (!profile.rowCount || profile.rows[0].status !== 'active') {
      return res.status(403).json({ message: 'Student account is not active' });
    }
    const studentProfile = profile.rows[0];

    await pool.query(
      `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
       VALUES ($1, $2, $3, TRUE)`,
      [school.id, login_code, ip],
    );

    const token = await generateToken(user, pool);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        school_id: user.school_id,
        login_code: user.login_code,
        avatar: user.avatar,
      },
      school: {
        id: school.id,
        name: school.name,
        login_code: school.login_code,
      },
      profile: {
        status: studentProfile.status,
        academic_year: studentProfile.academic_year,
        grade_id: studentProfile.grade_id,
        grade_name: studentProfile.grade_name,
        classroom_id: studentProfile.classroom_id,
        classroom_name: studentProfile.classroom_name,
        seat_number: studentProfile.seat_number,
      },
      token,
    });
  }),
);

/** Parent login with guardian code only (globally unique). */
router.post(
  '/login/parent',
  validate(LoginParentByCode),
  asyncWrapper(async (req, res) => {
    const { login_code } = req.body;
    const ip = req.ip || req.socket.remoteAddress || null;

    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS failed
       FROM login_code_attempts
       WHERE ip_address = $1
         AND success = FALSE
         AND created_at > NOW() - INTERVAL '15 minutes'`,
      [ip],
    );
    if (attempts.rows[0].failed >= 20) {
      return res.status(429).json({
        message: 'Too many failed login attempts. Please try again later.',
      });
    }

    const userQuery = await pool.query(
      `SELECT u.*
       FROM users u
       WHERE u.login_code = $1
         AND u.role = 'parent'
         AND u.deleted_at IS NULL`,
      [login_code],
    );

    if (!userQuery.rowCount || userQuery.rows[0].is_active === false) {
      await pool.query(
        `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
         VALUES (NULL, $1, $2, FALSE)`,
        [login_code, ip],
      );
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = userQuery.rows[0];

    const schoolResult = await pool.query(
      `SELECT id, name, login_code, is_active, deleted_at
       FROM schools WHERE id = $1`,
      [user.school_id],
    );
    if (
      !schoolResult.rowCount ||
      schoolResult.rows[0].deleted_at ||
      !schoolResult.rows[0].is_active
    ) {
      return res.status(403).json({ message: 'School account is inactive' });
    }
    const school = schoolResult.rows[0];

    await pool.query(
      `INSERT INTO login_code_attempts (school_id, login_code, ip_address, success)
       VALUES ($1, $2, $3, TRUE)`,
      [school.id, login_code, ip],
    );

    const token = await generateToken(user, pool);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        school_id: user.school_id,
        login_code: user.login_code,
        avatar: user.avatar,
      },
      school: {
        id: school.id,
        name: school.name,
        login_code: school.login_code,
      },
      token,
    });
  }),
);

router.post(
  '/login/code',
  validate(LoginByCode),
  asyncWrapper(async (req, res) => {
    const { school_code, login_code, role } = req.body;
    const ip = req.ip || req.socket.remoteAddress || null;
    const result = await loginBySchoolAndCode({
      schoolCode: school_code,
      loginCode: login_code,
      role,
      ip,
    });
    res.status(result.status).json(result.body);
  }),
);

router.post(
  '/login',
  validate(Login),
  asyncWrapper(async (req, res) => {
    const { email, phone, password } = req.body;

    let userQuery;
    if (email) {
      userQuery = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    } else {
      userQuery = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    }

    if (!userQuery.rowCount) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = userQuery.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (user.role === 'school_admin' || (user.role === 'teacher' && user.school_id)) {
      if (!user.school_id) {
        return res.status(403).json({ message: 'School account is not linked to a school' });
      }

      const schoolResult = await pool.query(
        'SELECT id, is_active, deleted_at FROM schools WHERE id = $1',
        [user.school_id],
      );

      if (
        !schoolResult.rowCount ||
        schoolResult.rows[0].deleted_at ||
        !schoolResult.rows[0].is_active
      ) {
        return res.status(403).json({ message: 'School account is inactive' });
      }
    }

    if (user.role === 'teacher' && user.school_id) {
      if (user.deleted_at || user.is_active === false) {
        return res.status(403).json({ message: 'Teacher account is inactive' });
      }
    }

    const token = await generateToken(user, pool);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        school_id: user.school_id ?? null,
      },
      token,
    });
  }),
);

router.post('/forgot-password', validate(ForgotPassword), async (req, res) => {
  const { email } = req.body;

  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!result.rowCount) return res.status(200).json({ message: 'If user exists, email was sent' });

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO password_resets (user_id, token) VALUES ($1, $2)', [
    result.rows[0].id,
    token,
  ]);

  const resetLink = `${config.FRONTEND_HOST}/reset-password?token=${token}`;
  await sendEmail(
    email,
    'Password Reset',
    `<p>Click <a href="${resetLink}">here</a> to reset your password.</p>`,
  );

  res.status(200).json({ message: 'If user exists, email was sent' });
});

router.post('/reset-password', validate(ResetPassword), async (req, res) => {
  const { token, password } = req.body;

  const result = await pool.query('SELECT user_id FROM password_resets WHERE token = $1', [token]);
  if (!result.rowCount) return res.status(400).json({ message: 'Invalid or expired token' });

  const userId = result.rows[0].user_id;
  const hashed = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
  await pool.query('DELETE FROM password_resets WHERE token = $1', [token]);

  res.status(200).json({ message: 'Password updated successfully' });
});
