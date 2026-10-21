import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { HttpError } from '../utils';
import type { JwtAuthPayload, PlatformRole } from '../shared/roles';

export type RequestContext = {
  userId: string;
  tenantId: string | null;
  branchId: string | null;
  branchIds: string[];
  role: PlatformRole;
};

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
      authPayload?: JwtAuthPayload;
    }
  }
}

export const authenticateJwt: RequestHandler = (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'Unauthorized');
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtAuthPayload;
    if (payload.type !== 'access') {
      throw new HttpError(401, 'Invalid access token');
    }

    req.authPayload = payload;
    req.context = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      branchId: req.header('x-branch-id') || payload.branchIds[0] || null,
      branchIds: payload.branchIds || [],
      role: payload.role,
    };
    next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, 'Invalid token'));
  }
};

export const optionalAuthenticateJwt: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  return authenticateJwt(req, _res, next);
};
