import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const boolFromForm = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

export const CreateSchoolSchema = z
  .object({
    name: z.string().trim().min(1, 'School name is required'),
    description: optionalString,
    email: z.string().trim().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirm_password: z.string().min(6, 'Confirm password is required'),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export const UpdateSchoolSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    email: z.string().trim().email('Invalid email').optional(),
    password: z
      .string()
      .min(6, 'Password must be at least 6 characters')
      .optional()
      .or(z.literal('')),
    confirm_password: z.string().optional().or(z.literal('')),
    is_active: boolFromForm,
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
  });

export type CreateSchoolInput = z.infer<typeof CreateSchoolSchema>;
export type UpdateSchoolInput = z.infer<typeof UpdateSchoolSchema>;
