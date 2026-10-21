import { RequestHandler } from 'express';
import { z } from 'zod/v4';

export function validate(schema?: any): RequestHandler {
  return async (req, res, next) => {
    if (!schema) return next();

    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        message: 'Validation failed',
        errors: z.treeifyError(result.error),
      });
    } else {
      req.body = result.data;
      next();
    }
  };
}
