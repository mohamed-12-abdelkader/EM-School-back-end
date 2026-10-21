import { z } from 'zod';

const positiveInt = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v)));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const attendanceStatus = z.enum(['present', 'absent', 'late', 'excused']);

const optionalText = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .nullable()
  .transform((v) => (v === '' ? null : v));

export const QrCheckInSchema = z
  .object({
    qr_payload: z.string().trim().min(1).optional(),
    qr_token: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.qr_payload || d.qr_token, {
    message: 'qr_payload or qr_token is required',
  });

export const ManualAttendanceSchema = z
  .object({
    student_id: positiveInt,
    date: isoDate.optional(),
    status: attendanceStatus,
    absence_reason: optionalText,
    notes: optionalText,
    excuse_approved: z.boolean().optional().nullable(),
    edit_reason: optionalText,
  })
  .superRefine((data, ctx) => {
    if ((data.status === 'absent' || data.status === 'excused') && data.absence_reason === null) {
      // allow undefined absence_reason, but explicit empty becomes null via transform
    }
  });

export const BulkAttendanceSchema = z.object({
  date: isoDate.optional(),
  grade_id: positiveInt.optional(),
  classroom_id: positiveInt.optional(),
  items: z
    .array(
      z.object({
        student_id: positiveInt,
        status: attendanceStatus,
        absence_reason: optionalText,
        notes: optionalText,
        excuse_approved: z.boolean().optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const UpdateAttendanceSchema = z
  .object({
    status: attendanceStatus.optional(),
    absence_reason: optionalText,
    notes: optionalText,
    excuse_approved: z.boolean().optional().nullable(),
    edit_reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.absence_reason !== undefined ||
      d.notes !== undefined ||
      d.excuse_approved !== undefined,
    { message: 'At least one field to update is required' },
  );

export const CancelAttendanceSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});
