import { z } from 'zod';

export const SubmitExamSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.coerce.number().int().positive(),
        choice_id: z.coerce.number().int().positive().optional().nullable(),
        written_answer: z.string().max(10000).optional().nullable(),
      }),
    )
    .default([]),
});

export const SubmitTaskSchema = z.object({
  submission_note: z.string().max(5000).optional().nullable(),
  answers: z
    .array(
      z.object({
        question_id: z.coerce.number().int().positive(),
        choice_id: z.coerce.number().int().positive().optional().nullable(),
        written_answer: z.string().max(10000).optional().nullable(),
      }),
    )
    .default([]),
});
