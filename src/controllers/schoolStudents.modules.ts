import { z } from 'zod';

const positiveInt = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

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

const studentStatus = z.enum(['active', 'suspended', 'archived']);
const parentRelation = z.enum(['father', 'mother', 'guardian', 'other']);

const parentInput = z.object({
  parent_id: positiveInt.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: optionalPhone,
  email: optionalEmail,
  national_id: z.string().trim().max(50).optional().nullable(),
  secondary_phone: optionalPhone.nullable().optional(),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  relation: parentRelation.default('guardian'),
  is_primary: z.boolean().optional().default(true),
});

export const CreateSchoolStudentSchema = z
  .object({
    name: z.string().trim().min(1, 'Student name is required').max(120),
    national_id: z.string().trim().max(50).optional().nullable(),
    birth_date: z.string().date().optional().nullable().or(z.literal('')),
    gender: z.string().trim().max(20).optional().nullable(),
    phone: optionalPhone,
    email: optionalEmail,
    address: z.string().trim().max(500).optional().nullable(),
    academic_year: z.string().trim().min(1).max(32),
    grade_id: positiveInt,
    classroom_id: positiveInt,
    enrollment_date: z.string().date().optional().nullable().or(z.literal('')),
    seat_number: z.string().trim().max(40).optional().nullable(),
    status: studentStatus.optional().default('active'),
    notes: z.string().trim().max(1000).optional().nullable(),
    parent: parentInput,
  })
  .superRefine((data, ctx) => {
    if (!data.parent.parent_id) {
      if (!data.parent.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Parent name is required when creating a new parent',
          path: ['parent', 'name'],
        });
      }
      if (!data.parent.phone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Parent phone is required when creating a new parent',
          path: ['parent', 'phone'],
        });
      }
    }
  });

export const UpdateSchoolStudentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    national_id: z.string().trim().max(50).optional().nullable(),
    birth_date: z.string().date().optional().nullable().or(z.literal('')),
    gender: z.string().trim().max(20).optional().nullable(),
    phone: optionalPhone.nullable(),
    email: optionalEmail.nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    seat_number: z.string().trim().max(40).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    status: studentStatus.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

export const TransferStudentSchema = z.object({
  grade_id: positiveInt,
  classroom_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32).optional(),
});

export const UpdateStudentStatusSchema = z.object({
  status: studentStatus,
});
