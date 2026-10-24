import { z } from 'zod';

export const ChildIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const LessonIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  lessonId: z.coerce.number().int().positive(),
});

export const SubjectIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  subjectId: z.coerce.number().int().positive(),
});

export const AttendanceQuerySchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const SubjectIdQuerySchema = z.object({
  subject_id: z.coerce.number().int().positive().optional(),
});
