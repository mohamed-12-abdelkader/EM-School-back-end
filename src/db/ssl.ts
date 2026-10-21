/**
 * Aiven / corporate proxies often present a cert chain Node rejects by default.
 * Keep verification opt-in via DATABASE_SSL_REJECT_UNAUTHORIZED=true.
 */
export const pgSsl =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true'
    ? { rejectUnauthorized: true as const }
    : { rejectUnauthorized: false as const };
