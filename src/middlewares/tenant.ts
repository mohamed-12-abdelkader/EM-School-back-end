import { RequestHandler } from 'express';
import pool from '../db/pool';
import { getRedis, isRedisAvailable } from '../config/redis';
import { HttpError } from '../utils';

export type TenantContext = {
  tenantId: string;
  branchId: string | null;
  role: string;
  enabledModules: string[];
  quotaMaxStudents: number;
};

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

type CachedTenant = {
  is_active: boolean;
  enabled_modules: string[];
  quota_max_students: number;
};

async function loadTenant(tenantId: string): Promise<CachedTenant | null> {
  const cacheKey = `tenant:entitlements:${tenantId}`;
  try {
    if (isRedisAvailable()) {
      const cached = await getRedis().get(cacheKey);
      if (cached) return JSON.parse(cached) as CachedTenant;
    }
  } catch {
    // Redis optional at boot — fall through to DB
  }

  const result = await pool.query<{
    is_active: boolean;
    enabled_modules: string[] | string;
    quota_max_students: number;
  }>(
    `SELECT is_active, enabled_modules, quota_max_students
     FROM tenants
     WHERE id = $1`,
    [tenantId],
  );

  if (!result.rowCount) return null;

  const row = result.rows[0];
  const modules = Array.isArray(row.enabled_modules)
    ? row.enabled_modules
    : (JSON.parse(String(row.enabled_modules)) as string[]);

  const payload: CachedTenant = {
    is_active: row.is_active,
    enabled_modules: modules,
    quota_max_students: row.quota_max_students,
  };

  try {
    if (isRedisAvailable()) {
      await getRedis().set(cacheKey, JSON.stringify(payload), 'EX', 60);
    }
  } catch {
    // ignore cache write failures
  }

  return payload;
}

/**
 * Requires authenticated user + JWT/header tenant scope.
 * Prefer `x-tenant-id` / `x-branch-id` headers; fall back to JWT claims when present.
 */
export function tenantMiddleware(requiredModule?: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized');

      const headerTenant = req.header('x-tenant-id');
      const jwtTenant = (req as { auth?: { tenant_id?: string } }).auth?.tenant_id;
      const tenantId = headerTenant || jwtTenant;

      if (!tenantId) {
        throw new HttpError(400, 'Missing tenant scope (x-tenant-id)');
      }

      const tenant = await loadTenant(tenantId);
      if (!tenant || !tenant.is_active) {
        throw new HttpError(403, 'Tenant inactive or not found');
      }

      if (requiredModule && !tenant.enabled_modules.includes(requiredModule)) {
        throw new HttpError(403, `Module ${requiredModule} is not enabled for this tenant`);
      }

      const branchId = req.header('x-branch-id') || null;

      req.tenant = {
        tenantId,
        branchId,
        role: req.user.role,
        enabledModules: tenant.enabled_modules,
        quotaMaxStudents: tenant.quota_max_students,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
