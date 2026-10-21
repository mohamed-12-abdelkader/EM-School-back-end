import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  CORS_ORIGIN: z.string().min(1),
  FRONTEND_HOST: z.string().min(1),

  /** JWT secrets — JWT_SECRET preferred; falls back to SECRET_KEY */
  JWT_SECRET: z.string().min(16).optional(),
  SECRET_KEY: z.string().min(16).optional(),
  ACCESS_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().positive().default(60 * 24),
  REFRESH_TOKEN_EXPIRE_DAYS: z.coerce.number().int().positive().default(30),
  COMMON_TOKEN_EXPIRE_HOURS: z.coerce.number().int().positive().default(8),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('admissions-docs'),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a Postgres URI (Supabase pooler recommended)',
    ),
  DATABASE_SSL: boolFromEnv,
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  FIRST_SUPERUSER: z.string().optional(),
  FIRST_SUPERUSER_PASSWORD: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_TLS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SMTP_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  EMAILS_FROM_EMAIL: z.string().optional(),
  EMAILS_FROM_NAME: z.string().optional(),

  CLOUDINARY_URL: z.string().min(1),
  PUBLIC_API_URL: z.string().default('http://localhost:8000'),

  HARDWARE_WEBHOOK_SECRET: z.string().optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  SMS_GATEWAY_URL: z.string().optional(),
  SMS_GATEWAY_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

const data = parsed.data;
const jwtSecret = data.JWT_SECRET || data.SECRET_KEY;
if (!jwtSecret) {
  throw new Error('JWT_SECRET or SECRET_KEY is required');
}

const isSupabaseHost =
  data.DATABASE_URL.includes('supabase.co') || data.DATABASE_URL.includes('pooler.supabase.com');

export const env = {
  ...data,
  JWT_SECRET: jwtSecret,
  SECRET_KEY: jwtSecret,
  DATABASE_SSL: data.DATABASE_SSL ?? isSupabaseHost,
};

export const config = {
  ...env,
  isDev: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
};
