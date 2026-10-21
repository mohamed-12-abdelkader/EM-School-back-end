import { z } from 'zod';

const positiveInt = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform((v) =>
  typeof v === 'number' ? v : Number(v),
);

const boolFromBody = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

export const CreateSchoolTeacherSchema = z
  .object({
    name: z.string().trim().min(1, 'Teacher name is required').max(120),
    email: z.string().trim().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirm_password: z.string().min(6, 'Confirm password is required'),
    subject_id: positiveInt,
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export const UpdateSchoolTeacherSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email('Invalid email').optional(),
    subject_id: positiveInt.optional(),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters')
      .optional()
      .or(z.literal('')),
    confirm_password: z.string().optional().or(z.literal('')),
    is_active: boolFromBody,
  })
  .superRefine((data, ctx) => {
    const password = data.password;
    if (password && password.length > 0) {
      if (!data.confirm_password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Confirm password is required when setting a new password',
          path: ['confirm_password'],
        });
      } else if (password !== data.confirm_password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Passwords do not match',
          path: ['confirm_password'],
        });
      }
    }
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.email !== undefined ||
      data.subject_id !== undefined ||
      (data.password !== undefined && data.password.length > 0) ||
      data.is_active !== undefined,
    { message: 'At least one field is required to update' },
  );
