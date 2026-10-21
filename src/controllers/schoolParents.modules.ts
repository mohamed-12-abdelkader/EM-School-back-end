import { z } from 'zod';

const optionalPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' || v === undefined ? undefined : v));

const optionalEmail = z
  .string()
  .trim()
  .email()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === '' || v === undefined ? undefined : v));

export const UpdateSchoolParentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: optionalPhone,
    email: optionalEmail.nullable(),
    national_id: z.string().trim().max(50).optional().nullable(),
    secondary_phone: optionalPhone.nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    is_active: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (typeof v === 'boolean') return v;
        return v === 'true' || v === '1';
      }),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });
