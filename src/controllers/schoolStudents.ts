import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError, upload, uploadToCloudinary } from '../utils';
import pool from '../db/pool';
import {
  allocateUniqueStudentLoginCode,
  allocateUniqueParentLoginCode,
  allocateUniqueQrToken,
  buildQrPayload,
} from '../services/accessCodes';
import {
  CreateSchoolStudentSchema,
  TransferStudentSchema,
  UpdateSchoolStudentSchema,
  UpdateStudentStatusSchema,
} from './schoolStudents.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'School account is not linked to a school');
  }
  return user.school_id;
}

async function assertClassroomInGrade(schoolId: number, gradeId: number, classroomId: number) {
  const result = await pool.query(
    `SELECT c.id, c.name, g.id AS grade_id, g.name AS grade_name
     FROM classrooms c
     JOIN grades g ON g.id = c.grade_id
     WHERE c.id = $1 AND c.school_id = $2 AND c.grade_id = $3
       AND c.deleted_at IS NULL AND g.deleted_at IS NULL AND g.school_id = $2`,
    [classroomId, schoolId, gradeId],
  );
  if (!result.rowCount) {
    throw new HttpError(400, 'Classroom does not belong to the selected grade in your school');
  }
  return result.rows[0];
}

const STUDENT_SELECT = `
  SELECT
    u.id,
    u.school_id,
    u.name,
    u.email,
    u.phone,
    u.avatar,
    u.login_code,
    u.qr_token,
    u.qr_issued_at,
    u.is_active,
    u.created_at,
    u.deleted_at,
    sp.national_id,
    sp.birth_date,
    sp.gender,
    sp.address,
    sp.academic_year,
    sp.grade_id,
    g.name AS grade_name,
    sp.classroom_id,
    c.name AS classroom_name,
    sp.enrollment_date,
    sp.seat_number,
    sp.status,
    sp.notes,
    sp.updated_at AS profile_updated_at
  FROM users u
  JOIN student_profiles sp ON sp.user_id = u.id
  JOIN grades g ON g.id = sp.grade_id
  JOIN classrooms c ON c.id = sp.classroom_id
`;

async function loadStudentParents(studentId: number) {
  const result = await pool.query(
    `SELECT
       p.id,
       p.name,
       p.email,
       p.phone,
       p.login_code,
       p.is_active,
       pp.national_id,
       pp.secondary_phone,
       pp.address,
       pp.notes,
       ps.relation,
       ps.is_primary
     FROM parent_students ps
     JOIN users p ON p.id = ps.parent_id
     LEFT JOIN parent_profiles pp ON pp.user_id = p.id
     WHERE ps.student_id = $1 AND p.deleted_at IS NULL
     ORDER BY ps.is_primary DESC, p.name ASC`,
    [studentId],
  );
  return result.rows;
}

async function findOrCreateParent(
  client: { query: typeof pool.query },
  schoolId: number,
  parent: {
    parent_id?: number;
    name?: string;
    phone?: string;
    email?: string;
    national_id?: string | null;
    secondary_phone?: string | null;
    address?: string | null;
    notes?: string | null;
  },
) {
  if (parent.parent_id) {
    const existing = await client.query(
      `SELECT id, name, phone, email, login_code
       FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'parent' AND deleted_at IS NULL`,
      [parent.parent_id, schoolId],
    );
    if (!existing.rowCount) {
      throw new HttpError(404, 'Parent not found in your school');
    }
    return { ...existing.rows[0], created: false };
  }

  // Reuse by phone within same school if present
  if (parent.phone) {
    const byPhone = await client.query(
      `SELECT id, name, phone, email, login_code
       FROM users
       WHERE school_id = $1 AND role = 'parent' AND phone = $2 AND deleted_at IS NULL`,
      [schoolId, parent.phone],
    );
    if (byPhone.rowCount) {
      return { ...byPhone.rows[0], created: false };
    }
  }

  const loginCode = await allocateUniqueParentLoginCode();
  const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

  const inserted = await client.query(
    `INSERT INTO users (name, phone, email, password, role, school_id, login_code, is_active)
     VALUES ($1, $2, $3, $4, 'parent', $5, $6, TRUE)
     RETURNING id, name, phone, email, login_code`,
    [
      parent.name,
      parent.phone ?? null,
      parent.email ?? null,
      randomPassword,
      schoolId,
      loginCode,
    ],
  );

  await client.query(
    `INSERT INTO parent_profiles (user_id, national_id, secondary_phone, address, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      inserted.rows[0].id,
      parent.national_id ?? null,
      parent.secondary_phone ?? null,
      parent.address ?? null,
      parent.notes ?? null,
    ],
  );

  return { ...inserted.rows[0], created: true };
}

router.get(
  '/',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const {
      limit = '20',
      skip = '0',
      search = '',
      grade_id,
      classroom_id,
      status,
      academic_year,
      include_deleted = 'false',
    } = req.query as Record<string, string | undefined>;

    const values: unknown[] = [schoolId];
    const conditions = ["u.role = 'student'", 'u.school_id = $1'];
    let i = 2;

    if (include_deleted !== 'true') {
      conditions.push('u.deleted_at IS NULL');
    }
    if (grade_id) {
      conditions.push(`sp.grade_id = $${i++}`);
      values.push(Number(grade_id));
    }
    if (classroom_id) {
      conditions.push(`sp.classroom_id = $${i++}`);
      values.push(Number(classroom_id));
    }
    if (status) {
      conditions.push(`sp.status = $${i++}`);
      values.push(status);
    }
    if (academic_year) {
      conditions.push(`sp.academic_year = $${i++}`);
      values.push(academic_year);
    }

    const q = (search || '').trim();
    if (q) {
      conditions.push(
        `(u.name ILIKE $${i} OR u.login_code ILIKE $${i} OR COALESCE(u.phone,'') ILIKE $${i} OR COALESCE(sp.national_id,'') ILIKE $${i} OR COALESCE(sp.seat_number,'') ILIKE $${i})`,
      );
      values.push(`%${q}%`);
      i++;
    }

    const whereSQL = `WHERE ${conditions.join(' AND ')}`;
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const skipNum = Math.max(Number(skip) || 0, 0);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       JOIN student_profiles sp ON sp.user_id = u.id
       ${whereSQL}`,
      values,
    );

    values.push(limitNum, skipNum);
    const rows = await pool.query(
      `${STUDENT_SELECT}
       ${whereSQL}
       ORDER BY u.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      values,
    );

    const counts = await pool.query(
      `SELECT sp.grade_id, g.name AS grade_name, sp.classroom_id, c.name AS classroom_name,
              COUNT(*)::int AS students_count
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       JOIN grades g ON g.id = sp.grade_id
       JOIN classrooms c ON c.id = sp.classroom_id
       WHERE u.school_id = $1 AND u.role = 'student' AND u.deleted_at IS NULL
       GROUP BY sp.grade_id, g.name, sp.classroom_id, c.name
       ORDER BY g.name, c.name`,
      [schoolId],
    );

    res.json({
      students: rows.rows,
      total: count.rows[0].total,
      limit: limitNum,
      skip: skipNum,
      counts_by_classroom: counts.rows,
    });
  }),
);

router.post(
  '/verify-qr',
  authMiddleware(['school_admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const { qr_payload, qr_token } = req.body as {
      qr_payload?: string;
      qr_token?: string;
    };

    let token = qr_token;
    if (!token && qr_payload) {
      const parts = String(qr_payload).split('|');
      if (parts.length >= 4 && parts[0] === 'EMS') {
        const payloadSchoolId = Number(parts[2]);
        if (payloadSchoolId !== schoolId) {
          throw new HttpError(403, 'QR belongs to another school');
        }
        token = parts[3];
      }
    }
    if (!token) throw new HttpError(400, 'qr_payload or qr_token is required');

    const result = await pool.query(
      `${STUDENT_SELECT}
       WHERE u.qr_token = $1 AND u.school_id = $2 AND u.role = 'student'
         AND u.deleted_at IS NULL AND sp.status = 'active'`,
      [token, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Invalid or inactive student QR');

    const student = result.rows[0];
    res.json({
      valid: true,
      student: {
        id: student.id,
        name: student.name,
        grade_id: student.grade_id,
        grade_name: student.grade_name,
        classroom_id: student.classroom_id,
        classroom_name: student.classroom_name,
        academic_year: student.academic_year,
        status: student.status,
      },
    });
  }),
);

router.get(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const result = await pool.query(
      `${STUDENT_SELECT}
       WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'student' AND u.deleted_at IS NULL`,
      [req.params.id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Student not found');

    const student = result.rows[0];
    const parents = await loadStudentParents(student.id);
    const school = await pool.query(`SELECT id, name, login_code FROM schools WHERE id = $1`, [
      schoolId,
    ]);

    res.json({
      student: {
        ...student,
        qr_payload: student.qr_token
          ? buildQrPayload(schoolId, student.qr_token)
          : null,
      },
      parents,
      school: school.rows[0],
    });
  }),
);

router.post(
  '/',
  authMiddleware(['school_admin']),
  upload.single('avatar'),
  validate(CreateSchoolStudentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const body = req.body;
    if (typeof body.parent === 'string') {
      try {
        body.parent = JSON.parse(body.parent);
      } catch {
        throw new HttpError(400, 'Invalid parent payload');
      }
    }

    await assertClassroomInGrade(schoolId, body.grade_id, body.classroom_id);

    if (body.phone) {
      const dupPhone = await pool.query(
        `SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
        [body.phone],
      );
      if (dupPhone.rowCount) throw new HttpError(409, 'Phone number already registered');
    }
    if (body.email) {
      const dupEmail = await pool.query(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [body.email],
      );
      if (dupEmail.rowCount) throw new HttpError(409, 'Email already registered');
    }

    const file = req.file ?? null;
    const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;

    const studentLoginCode = await allocateUniqueStudentLoginCode();
    const qrToken = await allocateUniqueQrToken();
    const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const parent = await findOrCreateParent(client, schoolId, body.parent);

      const studentInsert = await client.query(
        `INSERT INTO users
           (name, phone, email, password, role, school_id, avatar, login_code, qr_token, qr_issued_at, is_active)
         VALUES ($1,$2,$3,$4,'student',$5,$6,$7,$8,NOW(),TRUE)
         RETURNING id`,
        [
          body.name,
          body.phone ?? null,
          body.email ?? null,
          randomPassword,
          schoolId,
          avatar,
          studentLoginCode,
          qrToken,
        ],
      );
      const studentId = studentInsert.rows[0].id;

      await client.query(
        `INSERT INTO student_profiles
           (user_id, national_id, birth_date, gender, address, academic_year,
            grade_id, classroom_id, enrollment_date, seat_number, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          studentId,
          body.national_id || null,
          body.birth_date || null,
          body.gender || null,
          body.address || null,
          body.academic_year,
          body.grade_id,
          body.classroom_id,
          body.enrollment_date || null,
          body.seat_number || null,
          body.status || 'active',
          body.notes || null,
        ],
      );

      // keep user_grades in sync for legacy features
      await client.query(
        `INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [studentId, body.grade_id],
      );

      if (body.parent.is_primary !== false) {
        await client.query(
          `UPDATE parent_students SET is_primary = FALSE WHERE student_id = $1`,
          [studentId],
        );
      }

      await client.query(
        `INSERT INTO parent_students (parent_id, student_id, relation, is_primary)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (parent_id, student_id) DO UPDATE
           SET relation = EXCLUDED.relation, is_primary = EXCLUDED.is_primary`,
        [
          parent.id,
          studentId,
          body.parent.relation || 'guardian',
          body.parent.is_primary !== false,
        ],
      );

      await client.query('COMMIT');

      const student = (
        await pool.query(`${STUDENT_SELECT} WHERE u.id = $1`, [studentId])
      ).rows[0];
      const parents = await loadStudentParents(studentId);
      const school = (
        await pool.query(`SELECT id, name, login_code FROM schools WHERE id = $1`, [schoolId])
      ).rows[0];

      res.status(201).json({
        message: 'Student created successfully',
        student: {
          ...student,
          qr_payload: buildQrPayload(schoolId, qrToken),
        },
        parents,
        access: {
          school_login_code: school.login_code,
          student_login_code: studentLoginCode,
          parent_login_code: parent.login_code,
          parent_created: parent.created,
        },
        school,
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
  authMiddleware(['school_admin']),
  upload.single('avatar'),
  validate(UpdateSchoolStudentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    const body = req.body;

    const existing = await pool.query(
      `SELECT u.id FROM users u
       JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'student' AND u.deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Student not found');

    if (body.phone) {
      const dup = await pool.query(
        `SELECT id FROM users WHERE phone = $1 AND id <> $2 AND deleted_at IS NULL`,
        [body.phone, id],
      );
      if (dup.rowCount) throw new HttpError(409, 'Phone number already registered');
    }
    if (body.email) {
      const dup = await pool.query(
        `SELECT id FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL`,
        [body.email, id],
      );
      if (dup.rowCount) throw new HttpError(409, 'Email already registered');
    }

    const file = req.file ?? null;
    const avatar = file ? (await uploadToCloudinary(file.path)).secure_url : null;

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
      if (avatar) {
        userUpdates.push(`avatar = $${i++}`);
        userValues.push(avatar);
      }
      if (userUpdates.length) {
        userValues.push(id);
        await client.query(
          `UPDATE users SET ${userUpdates.join(', ')} WHERE id = $${i}`,
          userValues,
        );
      }

      const profileUpdates: string[] = [];
      const profileValues: unknown[] = [];
      let j = 1;
      const map: Array<[string, unknown]> = [
        ['national_id', body.national_id],
        ['birth_date', body.birth_date === '' ? null : body.birth_date],
        ['gender', body.gender],
        ['address', body.address],
        ['seat_number', body.seat_number],
        ['notes', body.notes],
        ['status', body.status],
      ];
      for (const [col, val] of map) {
        if (val !== undefined) {
          profileUpdates.push(`${col} = $${j++}`);
          profileValues.push(val);
        }
      }
      if (profileUpdates.length) {
        profileUpdates.push('updated_at = NOW()');
        profileValues.push(id);
        await client.query(
          `UPDATE student_profiles SET ${profileUpdates.join(', ')} WHERE user_id = $${j}`,
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

    const student = (await pool.query(`${STUDENT_SELECT} WHERE u.id = $1`, [id])).rows[0];
    res.json({
      message: 'Student updated successfully',
      student: {
        ...student,
        qr_payload: student.qr_token ? buildQrPayload(schoolId, student.qr_token) : null,
      },
    });
  }),
);

router.post(
  '/:id/transfer',
  authMiddleware(['school_admin']),
  validate(TransferStudentSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    const { grade_id, classroom_id, academic_year } = req.body;

    await assertClassroomInGrade(schoolId, grade_id, classroom_id);

    const existing = await pool.query(
      `SELECT u.id FROM users u
       JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1 AND u.school_id = $2 AND u.role = 'student' AND u.deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Student not found');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE student_profiles
         SET grade_id = $1, classroom_id = $2,
             academic_year = COALESCE($3, academic_year),
             updated_at = NOW()
         WHERE user_id = $4`,
        [grade_id, classroom_id, academic_year ?? null, id],
      );
      await client.query(`DELETE FROM user_grades WHERE user_id = $1`, [id]);
      await client.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)`, [
        id,
        grade_id,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const student = (await pool.query(`${STUDENT_SELECT} WHERE u.id = $1`, [id])).rows[0];
    res.json({ message: 'Student transferred successfully', student });
  }),
);

router.patch(
  '/:id/status',
  authMiddleware(['school_admin']),
  validate(UpdateStudentStatusSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);
    const { status } = req.body;

    const result = await pool.query(
      `UPDATE student_profiles sp
       SET status = $1, updated_at = NOW()
       FROM users u
       WHERE sp.user_id = u.id AND u.id = $2 AND u.school_id = $3
         AND u.role = 'student' AND u.deleted_at IS NULL
       RETURNING sp.user_id, sp.status`,
      [status, id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Student not found');

    await pool.query(
      `UPDATE users SET is_active = $1 WHERE id = $2`,
      [status === 'active', id],
    );

    res.json({ message: 'Student status updated', student: result.rows[0] });
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
       WHERE id = $1 AND school_id = $2 AND role = 'student' AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Student not found');

    const code = await allocateUniqueStudentLoginCode();
    await pool.query(`UPDATE users SET login_code = $1 WHERE id = $2`, [code, id]);

    res.json({
      message: 'Student login code regenerated',
      login_code: code,
    });
  }),
);

router.post(
  '/:id/regenerate-qr',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);

    const existing = await pool.query(
      `SELECT id FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'student' AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!existing.rowCount) throw new HttpError(404, 'Student not found');

    const token = await allocateUniqueQrToken();
    await pool.query(
      `UPDATE users SET qr_token = $1, qr_issued_at = NOW() WHERE id = $2`,
      [token, id],
    );

    res.json({
      message: 'Student QR token regenerated (previous token invalidated)',
      qr_token: token,
      qr_payload: buildQrPayload(schoolId, token),
    });
  }),
);

router.get(
  '/:id/qr.png',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);

    const result = await pool.query(
      `SELECT qr_token, name FROM users
       WHERE id = $1 AND school_id = $2 AND role = 'student' AND deleted_at IS NULL`,
      [id, schoolId],
    );
    if (!result.rowCount || !result.rows[0].qr_token) {
      throw new HttpError(404, 'Student QR not found');
    }

    const payload = buildQrPayload(schoolId, result.rows[0].qr_token);

    // Lazy require so server boots even if package missing during install
    const QRCode = (await import('qrcode')).default;
    const png = await QRCode.toBuffer(payload, {
      type: 'png',
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="student-${id}-qr.png"`,
    );
    res.send(png);
  }),
);

router.delete(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const id = Number(req.params.id);

    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW(), is_active = FALSE
       WHERE id = $1 AND school_id = $2 AND role = 'student' AND deleted_at IS NULL
       RETURNING id, name`,
      [id, schoolId],
    );
    if (!result.rowCount) throw new HttpError(404, 'Student not found or already deleted');

    await pool.query(
      `UPDATE student_profiles SET status = 'archived', updated_at = NOW() WHERE user_id = $1`,
      [id],
    );

    res.json({ message: 'Student archived successfully', student: result.rows[0] });
  }),
);
