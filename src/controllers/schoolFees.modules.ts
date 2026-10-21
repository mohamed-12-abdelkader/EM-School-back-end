import { z } from 'zod';

const positiveInt = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

const money = z
  .union([z.number(), z.string().regex(/^\d+(\.\d{1,2})?$/)])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v >= 0, 'Invalid amount');

const positiveMoney = money.refine((v) => v > 0, 'Amount must be greater than zero');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CreateFeeCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export const CreateFeeStructureSchema = z.object({
  category_id: positiveInt.optional().nullable(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  amount: money,
  academic_year: z.string().trim().min(1).max(32),
  grade_id: positiveInt.optional().nullable(),
  is_mandatory: z.boolean().optional().default(true),
  due_date: isoDate.optional().nullable(),
  assignment_scope: z.enum(['school', 'grade', 'students']).default('grade'),
});

export const AssignFeeSchema = z.object({
  fee_structure_id: positiveInt,
  student_ids: z.array(positiveInt).optional(),
});

export const AssignDirectFeeSchema = z.object({
  student_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  amount: money,
  due_date: isoDate.optional().nullable(),
  is_mandatory: z.boolean().optional().default(true),
  fee_structure_id: positiveInt.optional().nullable(),
});

export const CreateInstallmentPlanSchema = z
  .object({
    student_id: positiveInt,
    academic_year: z.string().trim().min(1).max(32),
    title: z.string().trim().max(120).optional().nullable(),
    total_amount: money.optional(),
    count: z.number().int().min(1).max(48).optional(),
    amounts: z.array(money).min(1).max(48).optional(),
    first_due_date: isoDate,
    interval_days: z.number().int().min(1).max(365).optional().default(30),
    due_dates: z.array(isoDate).optional(),
  })
  .refine((d) => (d.amounts && d.amounts.length > 0) || (d.count && d.total_amount != null), {
    message: 'Provide amounts[] or count + total_amount',
  });

export const RecordPaymentSchema = z.object({
  student_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32),
  amount: positiveMoney,
  method: z.enum(['cash', 'bank_transfer', 'card', 'online', 'other']).optional().default('cash'),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  installment_ids: z.array(positiveInt).optional(),
  idempotency_key: z.string().trim().min(8).max(100).optional().nullable(),
});

export const ApplyDiscountSchema = z.object({
  student_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32),
  fee_item_id: positiveInt.optional().nullable(),
  name: z.string().trim().min(1).max(120),
  discount_type: z.enum(['fixed', 'percent']),
  value: positiveMoney,
  reason: z.string().trim().max(500).optional().nullable(),
});

export const RecordRefundSchema = z.object({
  student_id: positiveInt,
  academic_year: z.string().trim().min(1).max(32),
  payment_id: positiveInt.optional().nullable(),
  amount: positiveMoney,
  reason: z.string().trim().min(1).max(500),
});

export const CancelInstallmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const UpdateInstallmentDueDateSchema = z.object({
  due_date: isoDate,
});

export const ReversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const UpdateFeeStructureSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  amount: money.optional(),
  due_date: isoDate.optional().nullable(),
  is_mandatory: z.boolean().optional(),
  is_active: z.boolean().optional(),
  grade_id: positiveInt.optional().nullable(),
  assignment_scope: z.enum(['school', 'grade', 'students']).optional(),
});
