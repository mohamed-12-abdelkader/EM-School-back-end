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

const positionFromBody = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/)])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return typeof v === 'number' ? v : Number(v);
  });

export const CreateSchoolGradeSchema = z.object({
  name: z.string().trim().min(1, 'Grade name is required').max(120),
  description: optionalString,
  position: positionFromBody,
  is_active: boolFromBody,
});

export const UpdateSchoolGradeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().optional(),
    position: positionFromBody,
    is_active: boolFromBody,
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.position !== undefined ||
      data.is_active !== undefined,
    { message: 'At least one field is required to update' },
  );

export const ReorderSchoolGradesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        position: z.number().int(),
      }),
    )
    .min(1, 'At least one grade is required'),
});
