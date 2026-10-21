import { RequestHandler } from 'express';
import pool from '../db/pool';
import { getRedis, isRedisAvailable } from '../config/redis';
import { HttpError } from '../utils';

export type TenantEntitlements = {
  is_active: boolean;
  enabled_modules: string[];
  quota_max_students: number;
  student_count: number;
};

async function loadEntitlements(tenantId: string): Promise<TenantEntitlements | null> {
  const cacheKey = `tenant:${tenantId}:entitlements`;

  if (isRedisAvailable()) {
    try {
      const cached = await getRedis().get(cacheKey);
      if (cached) return JSON.parse(cached) as TenantEntitlements;
    } catch {
      // fall through
    }
  }

  const result = await pool.query<{
    is_active: boolean;
    enabled_modules: unknown;
    quota_max_students: number;
    student_count: string;
  }>(
    `SELECT t.is_active, t.enabled_modules, t.quota_max_students,
            (SELECT COUNT(*)::text FROM students s WHERE s.tenant_id = t.id AND s.lifecycle_status = 'ACTIVE') AS student_count
     FROM tenants t
     WHERE t.id = $1`,
    [tenantId],
  );

  if (!result.rowCount) return null;

  const row = result.rows[0];
  const modules = Array.isArray(row.enabled_modules)
    ? (row.enabled_modules as string[])
    : (JSON.parse(String(row.enabled_modules)) as string[]);

  const payload: TenantEntitlements = {
    is_active: row.is_active,
    enabled_modules: modules,
    quota_max_students: row.quota_max_students,
    student_count: Number(row.student_count),
  };

  if (isRedisAvailable()) {
    try {
      await getRedis().set(cacheKey, JSON.stringify(payload), 'EX', 60);
    } catch {
      // ignore
    }
  }

  return payload;
}

/**
 * Checks tenant is_active + enabled_modules.
 * For write methods, also enforces quota_max_students when `checkQuota` is true.
 */
export function entitlementMiddleware(
  requiredModule?: string,
  options?: { checkQuota?: boolean },
): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.context?.tenantId) {
        if (req.context?.role === 'PLATFORM_SUPER_ADMIN') return next();
        throw new HttpError(400, 'Missing tenant scope');
      }

      const entitlements = await loadEntitlements(req.context.tenantId);
      if (!entitlements || !entitlements.is_active) {
        throw new HttpError(403, 'Tenant inactive or not found');
      }

      if (requiredModule && !entitlements.enabled_modules.includes(requiredModule)) {
        throw new HttpError(403, `Module ${requiredModule} is not enabled`);
      }

      const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (options?.checkQuota && isWrite && entitlements.student_count >= entitlements.quota_max_students) {
        throw new HttpError(403, 'Tenant student quota exceeded');
      }

      (req as { entitlements?: TenantEntitlements }).entitlements = entitlements;
      next();
    } catch (err) {
      next(err);
    }
  };
}
