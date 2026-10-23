import { RequestHandler } from 'express';
import { z } from 'zod/v4';

function reject(res: Parameters<RequestHandler>[1], error: unknown) {
  res.status(400).json({
    message: 'Validation failed',
    errors: z.treeifyError(error as z.ZodError),
  });
}

/** Validate request body; replaces `req.body` with parsed data. */
export function validate(schema?: any): RequestHandler {
  return async (req, res, next) => {
    if (!schema) return next();

    const result = schema.safeParse(req.body);
    if (!result.success) {
      reject(res, result.error);
    } else {
      req.body = result.data;
      next();
    }
  };
}

/** Validate route params; merges parsed values onto `req.params`. */
export function validateParams(schema: any): RequestHandler {
  return async (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      reject(res, result.error);
    } else {
      req.params = { ...req.params, ...result.data };
      next();
    }
  };
}

/** Validate query string; replaces `req.query` with parsed data. */
export function validateQuery(schema: any): RequestHandler {
  return async (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      reject(res, result.error);
    } else {
      req.query = result.data;
      next();
    }
  };
}
