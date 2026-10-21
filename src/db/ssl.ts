/**
 * SSL for managed Postgres (Supabase). Set DATABASE_SSL=true/false to override.
 * Default: enabled when DATABASE_URL points at Supabase.
 */
import { config } from '../config/env';

export const pgSsl = config.DATABASE_SSL
  ? { rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED }
  : undefined;
