import { z } from 'zod';

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  subscription_plan: z.string().max(50).default('ENTERPRISE'),
  quota_max_students: z.number().int().positive().default(2000),
  enabled_modules: z
    .array(z.enum(['SIS', 'LMS', 'FINANCE', 'HR', 'TRANSPORT', 'LIBRARY']))
    .default(['SIS', 'LMS', 'FINANCE', 'HR', 'TRANSPORT', 'LIBRARY']),
});

export const UpdateTenantSchema = CreateTenantSchema.partial().extend({
  is_active: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const CreateBranchSchema = z.object({
  name: z.string().min(2).max(255),
  code: z.string().min(1).max(30),
  address: z.string().optional(),
  timezone: z.string().default('Africa/Cairo'),
});

export const CreateAcademicYearSchema = z.object({
  branch_id: z.string().uuid().optional(),
  name: z.string().min(2).max(100),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  age_cutoff_month: z.number().int().min(1).max(12).default(10),
  age_cutoff_day: z.number().int().min(1).max(31).default(1),
  is_current: z.boolean().default(false),
});

export const CreateStreamSchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().min(2).max(100),
  grading_type: z.enum(['RUBRIC', 'PERCENTAGE_WEIGHTED', 'GPA_CREDIT', 'LETTER_BAND']),
});

export const CreateGradeLevelSchema = z.object({
  branch_id: z.string().uuid(),
  stream_id: z.string().uuid(),
  stage: z.enum(['KINDERGARTEN', 'ELEMENTARY', 'PREPARATORY', 'SECONDARY']),
  name: z.string().min(1).max(100),
  sequence_order: z.number().int().min(0),
  attendance_mode: z.enum(['DAILY', 'PERIOD_WISE']).default('DAILY'),
  min_age_years: z.number().positive().optional(),
  max_age_years: z.number().positive().optional(),
});

export const CreateSectionSchema = z.object({
  branch_id: z.string().uuid(),
  grade_level_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  name: z.string().min(1).max(50),
  capacity: z.number().int().positive().default(30),
});

export const AssignMembershipSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(6),
  full_name: z.string().min(2),
  branch_id: z.string().uuid().optional(),
  role: z.enum([
    'GROUP_EXECUTIVE',
    'SCHOOL_ADMIN',
    'ADMISSIONS_OFFICER',
    'ACADEMIC_COORDINATOR',
    'FINANCE_MANAGER',
    'HR_SPECIALIST',
    'LIBRARIAN',
    'TRANSPORT_MANAGER',
    'TEACHER',
    'PARENT',
    'STUDENT',
  ]),
});
