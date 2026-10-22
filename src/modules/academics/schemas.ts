import { z } from 'zod';

export const UpsertTimetableSettingsSchema = z.object({
  working_days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  periods_per_day: z.number().int().min(1).max(12).optional(),
  period_minutes: z.number().int().min(20).max(120).optional(),
  day_start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
});

export const CreateSubjectSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  branch_id: z.string().uuid().optional(),
});

export const CreateTimetableSchema = z.object({
  section_id: z.string().uuid(),
  academic_year_id: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
});

export const SlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  period_number: z.number().int().min(1).max(12),
  subject_id: z.string().uuid().nullable().optional(),
  teacher_name: z.string().max(200).nullable().optional(),
  room: z.string().max(80).nullable().optional(),
  slot_type: z.enum(['lesson', 'break', 'activity']).default('lesson'),
  notes: z.string().optional(),
});

export const ReplaceSlotsSchema = z.object({
  slots: z.array(SlotSchema).max(120),
});
