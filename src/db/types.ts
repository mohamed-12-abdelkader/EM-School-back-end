import { z } from 'zod';

export const UserRole = z.enum(['student', 'admin', 'teacher', 'school_admin', 'parent']);

export const UserBase = z.object({
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  password: z.string().min(6),
  name: z.string().min(1),
});

export const UserCreate = UserBase;

export const UserUpdate = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  name: z.string().optional(),
  role: UserRole.optional(),
});

export const User = UserBase.extend({
  id: z.number(),
  role: UserRole,
  jti: z.string().nullable().optional(),
  school_id: z.number().nullable().optional(),
  created_at: z.string().optional(),
});

export type User = z.infer<typeof User>;
export type UserRole = z.infer<typeof UserRole>;

export const School = z.object({
  id: z.number(),
  name: z.string(),
  logo: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
  deleted_at: z.string().nullable().optional(),
  admin_user_id: z.number().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export type School = z.infer<typeof School>;
