import { z } from 'zod';

export const CreateCategorySchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().optional(),
});

export const CreateStructureSchema = z.object({
  category_id: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  academic_year_id: z.string().uuid().optional(),
  grade_level_id: z.string().uuid().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().max(8).default('EGP'),
  installment_count: z.number().int().min(1).max(24).default(3),
  is_mandatory: z.boolean().default(true),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const AssignStructureSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
  assign_all_in_grade: z.boolean().default(false),
  first_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const RecordPaymentSchema = z.object({
  student_id: z.string().uuid(),
  installment_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  method: z.enum(['cash', 'bank_transfer', 'card', 'online', 'other']).default('cash'),
  reference: z.string().max(120).optional(),
  notes: z.string().optional(),
});
