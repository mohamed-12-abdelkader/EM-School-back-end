import { RequestHandler } from 'express';
import crypto from 'node:crypto';
import { config } from '../config/env';
import { HttpError } from '../utils';

/**
 * Verifies HMAC-SHA256 hex digest in `x-signature` over raw JSON body.
 * Skips verification when HARDWARE_WEBHOOK_SECRET is unset (dev only).
 */
export const hmacWebhookMiddleware: RequestHandler = (req, _res, next) => {
  try {
    const secret = config.HARDWARE_WEBHOOK_SECRET;
    if (!secret) {
      if (config.isProduction) throw new HttpError(503, 'Webhook secret not configured');
      return next();
    }

    const signature = req.header('x-signature') || '';
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }
    next();
  } catch (err) {
    next(err);
  }
};
