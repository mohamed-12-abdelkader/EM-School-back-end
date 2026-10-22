import { z } from 'zod';

export const CreateApplicationSchema = z.object({
  branch_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  target_grade_id: z.string().uuid(),
  applicant_full_name: z.string().min(2).max(255),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guardian_details: z.record(z.unknown()),
  documents: z
    .array(
      z.object({
        type: z.string(),
        path: z.string().optional(),
        url: z.string().optional(),
        status: z
          .enum(['PENDING', 'APPROVED', 'REJECTED_RESUBMIT', 'VERIFIED'])
          .default('PENDING'),
      }),
    )
    .default([]),
  family_group_id: z.string().uuid().optional(),
});

export const ScheduleExamSchema = z.object({
  entrance_exam_slot: z.string().datetime(),
  proctor_user_id: z.string().uuid().optional(),
});

export const RecordScoresSchema = z.object({
  entrance_exam_score: z.number().min(0).max(100).optional(),
  interview_score: z.number().min(0).max(100).optional(),
});

export const UpdateDocumentStatusSchema = z.object({
  documentIndex: z.number().int().min(0),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED_RESUBMIT', 'VERIFIED']),
});

export const PresignDocumentSchema = z.object({
  application_id: z.string().uuid(),
  document_type: z.string().min(1),
  content_type: z.string().optional(),
});

export const UpsertSeatQuotaSchema = z.object({
  branch_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  grade_level_id: z.string().uuid(),
  max_seats: z.number().int().positive(),
});

export const EnrollApplicationSchema = z.object({
  section_id: z.string().uuid().optional(),
  student_code: z.string().min(1).max(50).optional(),
  create_parent_account: z.boolean().default(true),
  parent_password: z.string().min(6).optional(),
});

export const AttachDocumentsSchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.string().min(1),
        path: z.string().optional(),
        url: z.string().optional(),
        file_name: z.string().optional(),
        status: z
          .enum(['PENDING', 'APPROVED', 'REJECTED_RESUBMIT', 'VERIFIED'])
          .default('PENDING'),
      }),
    )
    .min(1)
    .max(20),
});

export const PublicPresignDocumentSchema = z.object({
  document_type: z.string().min(1),
  content_type: z.string().optional(),
});
