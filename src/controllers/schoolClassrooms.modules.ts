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

const positiveIntFromBody = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

export const CreateSchoolClassroomSchema = z.object({
  grade_id: positiveIntFromBody,
  name: z.string().trim().min(1, 'Classroom name is required').max(120),
  description: optionalString,
  capacity: intFromBody.refine((v) => v === undefined || v >= 0, {
    message: 'Capacity must be 0 or greater',
  }),
  position: intFromBody,
  is_active: boolFromBody,
});

export const UpdateSchoolClassroomSchema = z
  .object({
    grade_id: positiveIntFromBody.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().optional(),
    capacity: z
      .union([
        z.number().int().min(0),
        z.string().regex(/^\d+$/),
        z.null(),
        z.literal(''),
      ])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null || v === '') return null;
        return typeof v === 'number' ? v : Number(v);
      }),
    position: intFromBody,
    is_active: boolFromBody,
  })
  .refine(
    (data) =>
      data.grade_id !== undefined ||
      data.name !== undefined ||
      data.description !== undefined ||
      data.capacity !== undefined ||
      data.position !== undefined ||
      data.is_active !== undefined,
    { message: 'At least one field is required to update' },
  );

export const ReorderSchoolClassroomsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        position: z.number().int(),
      }),
    )
    .min(1, 'At least one classroom is required'),
});
