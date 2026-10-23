import { z } from 'zod';

/** Reject titles that are mostly "?" — usually a Windows/UTF-8 encoding bug */
const readableTitle = z
  .string()
  .min(2)
  .max(200)
  .refine((v) => {
    const q = (v.match(/\?/g) || []).length;
    return q < v.length * 0.5;
  }, { message: 'Title looks corrupted (encoding). Use UTF-8 Arabic text.' });

export const CreateLessonSchema = z.object({
  classroom_id: z.coerce.number().int().positive(),
  subject_id: z.coerce.number().int().positive(),
  title: readableTitle,
  description: z.string().max(5000).optional().nullable(),
});

export const UpdateLessonSchema = z.object({
  title: readableTitle.optional(),
  description: z.string().max(5000).optional().nullable(),
});

export const AddAttachmentSchema = z.object({
  kind: z.enum(['video', 'pdf']),
  title: z.string().min(1).max(200),
  file_url: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  filename: z.string().max(255).optional().nullable(),
});

export const UpdateAttachmentSchema = z.object({
  kind: z.enum(['video', 'pdf']).optional(),
  title: z.string().min(1).max(200).optional(),
  file_url: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  filename: z.string().max(255).optional().nullable(),
});

const McqChoiceSchema = z.object({
  text: z.string().min(1).max(500),
  is_correct: z.boolean(),
});

const ExamQuestionSchema = z.object({
  type: z.enum(['mcq', 'written']),
  text: z.string().min(2).max(5000),
  points: z.coerce.number().positive().default(1),
  model_answer: z.string().max(5000).optional().nullable(),
  choices: z.array(McqChoiceSchema).optional(),
});

export const CreateExamSchema = z.object({
  classroom_id: z.coerce.number().int().positive(),
  subject_id: z.coerce.number().int().positive(),
  title: readableTitle,
  description: z.string().max(5000).optional().nullable(),
  duration_minutes: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['draft', 'published', 'closed']).optional().default('draft'),
  questions: z.array(ExamQuestionSchema).min(1),
});

export const UpdateExamSchema = z.object({
  title: readableTitle.optional(),
  description: z.string().max(5000).optional().nullable(),
  duration_minutes: z.coerce.number().int().positive().optional().nullable(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
  questions: z.array(ExamQuestionSchema).min(1).optional(),
});

export const CreateTaskSchema = z.object({
  classroom_id: z.coerce.number().int().positive(),
  subject_id: z.coerce.number().int().positive(),
  title: readableTitle,
  description: z.string().max(5000).optional().nullable(),
  max_grade: z.coerce.number().positive().default(100),
  due_at: z.string().optional().nullable(),
  /** Optional questions (same shape as exam questions) */
  questions: z.array(ExamQuestionSchema).optional().default([]),
});

export const UpdateTaskSchema = z.object({
  title: readableTitle.optional(),
  description: z.string().max(5000).optional().nullable(),
  max_grade: z.coerce.number().positive().optional(),
  due_at: z.string().optional().nullable(),
  questions: z.array(ExamQuestionSchema).optional(),
});

export const AddTaskAttachmentSchema = z.object({
  kind: z.enum(['pdf', 'video']).optional().default('pdf'),
  title: z.string().min(1).max(200),
  file_url: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  filename: z.string().max(255).optional().nullable(),
});

export const UpsertTaskGradeSchema = z.object({
  student_id: z.coerce.number().int().positive(),
  grade: z.coerce.number().min(0).nullable().optional(),
  review: z.string().max(5000).optional().nullable(),
});
