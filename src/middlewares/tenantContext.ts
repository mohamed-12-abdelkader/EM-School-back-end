import { RequestHandler } from 'express';
import { HttpError } from '../utils';

/**
 * Resolves tenant/branch onto req.context from JWT + headers.
 * Headers: x-tenant-id, x-branch-id (optional overrides when membership allows).
 */
export const tenantContextMiddleware: RequestHandler = (req, _res, next) => {
  try {
    if (!req.context) throw new HttpError(401, 'Unauthorized');

    const headerTenant = req.header('x-tenant-id');
    if (headerTenant) {
      if (
        req.context.role !== 'PLATFORM_SUPER_ADMIN' &&
        req.context.tenantId &&
        headerTenant !== req.context.tenantId
      ) {
        throw new HttpError(403, 'Cannot switch to another tenant');
      }
      req.context.tenantId = headerTenant;
    }

    if (!req.context.tenantId && req.context.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new HttpError(400, 'Missing tenant scope');
    }

    const headerBranch = req.header('x-branch-id');
    if (headerBranch) {
      if (
        req.context.branchIds.length > 0 &&
        !req.context.branchIds.includes(headerBranch) &&
        req.context.role !== 'PLATFORM_SUPER_ADMIN' &&
        req.context.role !== 'GROUP_EXECUTIVE'
      ) {
        throw new HttpError(403, 'Branch not in membership scope');
      }
      req.context.branchId = headerBranch;
    }

    next();
  } catch (err) {
    next(err);
  }
};
