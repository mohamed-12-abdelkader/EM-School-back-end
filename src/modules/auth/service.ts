import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import pool from '../../db/pool';
import { config } from '../../config/env';
import { HttpError } from '../../utils';
import type { JwtAuthPayload, PlatformRole } from '../../shared/roles';

type MtUser = {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  full_name: string;
  is_active: boolean;
  refresh_jti: string | null;
};

function signTokens(payload: Omit<JwtAuthPayload, 'type' | 'jti'> & { jti?: string }) {
  const access: JwtAuthPayload = { ...payload, type: 'access' };
  const refreshJti = payload.jti || randomUUID();
  const refresh: JwtAuthPayload = { ...payload, type: 'refresh', jti: refreshJti };

  const accessToken = jwt.sign(access, config.JWT_SECRET, {
    expiresIn: `${config.ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
  const refreshToken = jwt.sign(refresh, config.JWT_SECRET, {
    expiresIn: `${config.REFRESH_TOKEN_EXPIRE_DAYS}d`,
  });

  return { accessToken, refreshToken, refreshJti };
}

export async function login(input: {
  email?: string;
  phone?: string;
  password: string;
  tenantId?: string;
  role?: PlatformRole;
}) {
  const userResult = await pool.query<MtUser>(
    `SELECT * FROM mt_users
     WHERE (email = $1 OR phone = $2) AND is_active = TRUE
     LIMIT 1`,
    [input.email ?? null, input.phone ?? null],
  );
  if (!userResult.rowCount) throw new HttpError(401, 'Invalid credentials');

  const user = userResult.rows[0];
  const ok = await bcrypt.compare(input.password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Invalid credentials');

  const memberships = await pool.query<{
    tenant_id: string;
    branch_id: string | null;
    role: PlatformRole;
  }>(
    `SELECT tenant_id, branch_id, role FROM mt_memberships
     WHERE user_id = $1 AND is_active = TRUE
       AND ($2::uuid IS NULL OR tenant_id = $2 OR role::text = 'PLATFORM_SUPER_ADMIN')
       AND ($3::text IS NULL OR role::text = $3)
     ORDER BY
       CASE
         WHEN $3::text IS NOT NULL AND role::text = $3 THEN 0
         WHEN role::text = 'SCHOOL_ADMIN' THEN 1
         WHEN role::text = 'PLATFORM_SUPER_ADMIN' THEN 9
         ELSE 2
       END,
       created_at ASC`,
    [user.id, input.tenantId ?? null, input.role ?? null],
  );

  if (!memberships.rowCount) {
    throw new HttpError(403, 'No active membership');
  }

  const membership = memberships.rows[0];
  const role = membership.role;
  const tenantId = role === 'PLATFORM_SUPER_ADMIN' ? input.tenantId || membership.tenant_id : membership.tenant_id;

  const branches = await pool.query<{ branch_id: string }>(
    `SELECT DISTINCT branch_id FROM mt_memberships
     WHERE user_id = $1 AND tenant_id = $2 AND branch_id IS NOT NULL AND is_active`,
    [user.id, tenantId],
  );
  const branchIds = branches.rows.map((b) => b.branch_id);
  if (membership.branch_id && !branchIds.includes(membership.branch_id)) {
    branchIds.push(membership.branch_id);
  }

  const tokens = signTokens({
    sub: user.id,
    userId: user.id,
    tenantId,
    branchIds,
    role,
  });

  await pool.query(`UPDATE mt_users SET refresh_jti = $1 WHERE id = $2`, [
    tokens.refreshJti,
    user.id,
  ]);

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      full_name: user.full_name,
      role,
      tenantId,
      branchIds,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

export async function refresh(refreshToken: string) {
  let payload: JwtAuthPayload;
  try {
    payload = jwt.verify(refreshToken, config.JWT_SECRET) as JwtAuthPayload;
  } catch {
    throw new HttpError(401, 'Invalid refresh token');
  }
  if (payload.type !== 'refresh') throw new HttpError(401, 'Invalid refresh token');

  const userResult = await pool.query<MtUser>(`SELECT * FROM mt_users WHERE id = $1 AND is_active`, [
    payload.userId,
  ]);
  if (!userResult.rowCount) throw new HttpError(401, 'User not found');
  const user = userResult.rows[0];
  if (user.refresh_jti && user.refresh_jti !== payload.jti) {
    throw new HttpError(401, 'Refresh token revoked');
  }

  const tokens = signTokens({
    sub: user.id,
    userId: user.id,
    tenantId: payload.tenantId,
    branchIds: payload.branchIds,
    role: payload.role,
  });

  await pool.query(`UPDATE mt_users SET refresh_jti = $1 WHERE id = $2`, [
    tokens.refreshJti,
    user.id,
  ]);

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export async function ensurePlatformSuperAdmin() {
  if (!config.FIRST_SUPERUSER || !config.FIRST_SUPERUSER_PASSWORD) return;

  let userId: string;
  const existing = await pool.query(`SELECT id FROM mt_users WHERE email = $1`, [
    config.FIRST_SUPERUSER,
  ]);

  if (existing.rowCount) {
    userId = existing.rows[0].id;
  } else {
    const hash = await bcrypt.hash(config.FIRST_SUPERUSER_PASSWORD, 10);
    const user = await pool.query(
      `INSERT INTO mt_users (email, password_hash, full_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [config.FIRST_SUPERUSER, hash, 'Platform Super Admin'],
    );
    userId = user.rows[0].id;
  }

  let tenantId: string;
  const tenants = await pool.query(`SELECT id FROM tenants WHERE slug = 'platform' LIMIT 1`);
  if (tenants.rowCount) {
    tenantId = tenants.rows[0].id;
  } else {
    const any = await pool.query(`SELECT id FROM tenants ORDER BY created_at LIMIT 1`);
    if (any.rowCount) {
      tenantId = any.rows[0].id;
    } else {
      const t = await pool.query(
        `INSERT INTO tenants (name, slug, subscription_plan)
         VALUES ('Platform', 'platform', 'ENTERPRISE') RETURNING id`,
      );
      tenantId = t.rows[0].id;
    }
  }

  await pool.query(
    `INSERT INTO mt_memberships (tenant_id, user_id, role)
     SELECT $1, $2, 'PLATFORM_SUPER_ADMIN'
     WHERE NOT EXISTS (
       SELECT 1 FROM mt_memberships
       WHERE user_id = $2 AND role = 'PLATFORM_SUPER_ADMIN' AND is_active
     )`,
    [tenantId, userId],
  );
}

export async function createUserWithMembership(input: {
  email?: string;
  phone?: string;
  password: string;
  full_name: string;
  tenantId: string;
  branchId?: string | null;
  role: PlatformRole;
}) {
  const hash = await bcrypt.hash(input.password, 10);
  const user = await pool.query(
    `INSERT INTO mt_users (email, phone, password_hash, full_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [input.email ?? null, input.phone ?? null, hash, input.full_name],
  );
  const userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO mt_memberships (tenant_id, branch_id, user_id, role)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM mt_memberships
       WHERE tenant_id = $1 AND user_id = $3 AND role = $4
         AND branch_id IS NOT DISTINCT FROM $2
     )`,
    [input.tenantId, input.branchId ?? null, userId, input.role],
  );
  return userId;
}
