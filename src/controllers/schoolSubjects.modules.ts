import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const boolFromBody = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

const intFromBody = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/)])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return typeof v === 'number' ? v : Number(v);
  });

const gradeIdsFromBody = z
  .union([
    z.array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/)])),
    z.string(),
  ])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const raw = Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean);
    return raw.map((id) => (typeof id === 'number' ? id : Number(id)));
  })
  .refine((ids) => ids === undefined || ids.every((id) => Number.isInteger(id) && id > 0), {
    message: 'grade_ids must be positive integers',
  });

export const CreateSchoolSubjectSchema = z.object({
  name: z.string().trim().min(1, 'Subject name is required').max(120),
  code: optionalString,
  description: optionalString,
  position: intFromBody,
  is_active: boolFromBody,
  grade_ids: gradeIdsFromBody,
});

export const UpdateSchoolSubjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    code: z.string().optional().nullable(),
    description: z.string().optional(),
    position: intFromBody,
    is_active: boolFromBody,
    grade_ids: gradeIdsFromBody,
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.code !== undefined ||
      data.description !== undefined ||
      data.position !== undefined ||
      data.is_active !== undefined ||
      data.grade_ids !== undefined,
    { message: 'At least one field is required to update' },
  );

export const ReorderSchoolSubjectsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        position: z.number().int(),
      }),
    )
    .min(1, 'At least one subject is required'),
});
