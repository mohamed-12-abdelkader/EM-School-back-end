import { RequestHandler } from 'express';
import { HttpError } from '../utils';
import { ROLE_SCOPE, type PlatformRole, type RbacScope } from '../shared/roles';

export function rbacMiddleware(
  allowedRoles: PlatformRole[],
  requiredScope: RbacScope = 'branch',
): RequestHandler {
  return (req, _res, next) => {
    try {
      if (!req.context) throw new HttpError(401, 'Unauthorized');

      const { role } = req.context;
      if (!allowedRoles.includes(role) && role !== 'PLATFORM_SUPER_ADMIN') {
        throw new HttpError(403, 'Forbidden: insufficient role');
      }

      const roleScope = ROLE_SCOPE[role];
      const scopeRank: Record<RbacScope, number> = {
        branch: 1,
        cross_branch: 2,
        cross_tenant: 3,
      };

      if (scopeRank[roleScope] < scopeRank[requiredScope] && role !== 'PLATFORM_SUPER_ADMIN') {
        throw new HttpError(403, `Forbidden: requires ${requiredScope} scope`);
      }

      if (requiredScope === 'branch' && roleScope === 'branch' && !req.context.branchId) {
        // Parents/students may operate without explicit branch header when JWT has branches
        if (!req.context.branchIds.length && !['PARENT', 'STUDENT'].includes(role)) {
          throw new HttpError(400, 'x-branch-id required for branch-scoped action');
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
