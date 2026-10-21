import { z } from 'zod';

const positiveInt = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

const dayOfWeek = z
  .union([z.number().int().min(0).max(6), z.string().regex(/^[0-6]$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

const periodNumber = z
  .union([z.number().int().min(1).max(20), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid time format (HH:MM)');

const boolFromBody = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === '1';
  });

const slotType = z.enum(['lesson', 'break', 'activity', 'reserve']);

export const UpdateTimetableSettingsSchema = z.object({
  working_days: z.array(dayOfWeek).min(1).max(7).optional(),
  periods_per_day: z.number().int().min(1).max(20).optional(),
  default_period_minutes: z.number().int().min(5).max(240).optional(),
  day_start_time: timeString.optional(),
  day_end_time: timeString.optional(),
  allow_teacher_conflicts: boolFromBody,
});

export const UpsertPeriodTemplatesSchema = z.object({
  periods: z
    .array(
      z.object({
        day_of_week: dayOfWeek.nullable().optional(),
        period_number: periodNumber,
        start_time: timeString,
        end_time: timeString,
        label: z.string().trim().max(80).optional().nullable(),
        slot_type: slotType.optional().default('lesson'),
      }),
    )
    .min(1),
});

export const TimetableSlotSchema = z
  .object({
    id: positiveInt.optional(),
    day_of_week: dayOfWeek,
    period_number: periodNumber,
    start_time: timeString,
    end_time: timeString,
    slot_type: slotType.default('lesson'),
    subject_id: positiveInt.nullable().optional(),
    teacher_id: positiveInt.nullable().optional(),
    notes: z.string().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.slot_type === 'lesson') {
      if (!data.subject_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'subject_id is required for lesson slots',
          path: ['subject_id'],
        });
      }
      if (!data.teacher_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'teacher_id is required for lesson slots',
          path: ['teacher_id'],
        });
      }
    }
  });

export const CreateTimetableSchema = z.object({
  classroom_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32),
  term: z.string().trim().min(1).max(32).default('1'),
  title: z.string().trim().max(120).optional().nullable(),
  slots: z.array(TimetableSlotSchema).optional().default([]),
  skip_conflict_check: z.boolean().optional().default(false),
});

export const UpdateTimetableMetaSchema = z.object({
  title: z.string().trim().max(120).optional().nullable(),
  academic_year: z.string().trim().min(1).max(32).optional(),
  term: z.string().trim().min(1).max(32).optional(),
});

export const ReplaceSlotsSchema = z.object({
  slots: z.array(TimetableSlotSchema),
  skip_conflict_check: z.boolean().optional().default(false),
});

export const UpsertSlotSchema = TimetableSlotSchema;

export const CopyTimetableSchema = z.object({
  target_classroom_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32).optional(),
  term: z.string().trim().min(1).max(32).optional(),
  title: z.string().trim().max(120).optional().nullable(),
  replace_existing: z.boolean().optional().default(false),
  skip_conflict_check: z.boolean().optional().default(false),
});

export const PublishTimetableSchema = z.object({
  force: z.boolean().optional().default(false),
});
