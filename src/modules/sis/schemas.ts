import { z } from 'zod';

export const CreateFamilyGroupSchema = z.object({
  display_name: z.string().min(2).max(255),
  notes: z.string().optional(),
});

export const CreateGuardianSchema = z.object({
  family_group_id: z.string().uuid(),
  full_name: z.string().min(2),
  relationship: z.string().default('PARENT'),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  is_primary: z.boolean().default(false),
  has_custody: z.boolean().default(true),
  is_financially_responsible: z.boolean().default(true),
  is_emergency_contact: z.boolean().default(true),
  can_pickup: z.boolean().default(true),
  user_id: z.string().uuid().optional(),
});

export const CreateStudentSchema = z.object({
  branch_id: z.string().uuid(),
  family_group_id: z.string().uuid(),
  student_code: z.string().min(1).max(50),
  full_name: z.string().min(2).max(255),
  grade_level_id: z.string().uuid().optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.string().optional(),
  national_id: z.string().optional(),
  rfid_card_uid: z.string().max(100).optional(),
  biometric_device_user_id: z.string().max(50).optional(),
  current_section_id: z.string().uuid().optional(),
  medical_profile: z
    .object({
      allergies: z.array(z.string()).default([]),
      conditions: z.array(z.string()).default([]),
      blood_type: z.string().optional(),
      emergency_notes: z.string().default(''),
    })
    .optional(),
});

export const UpdateMedicalSchema = z.object({
  medical_profile: z.object({
    allergies: z.array(z.string()).default([]),
    conditions: z.array(z.string()).default([]),
    blood_type: z.string().optional(),
    emergency_notes: z.string().default(''),
  }),
});

export const CreateClinicVisitSchema = z.object({
  student_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  symptoms: z.string().min(1),
  treatment: z.string().optional(),
  nurse_notes: z.string().optional(),
  parent_contacted: z.boolean().default(false),
  visited_at: z.string().datetime().optional(),
});

export const CreateBehaviorSchema = z.object({
  student_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  incident_type: z.enum(['MERIT', 'DEMERIT', 'DETENTION', 'COUNSELING', 'SUMMONS']),
  category: z.string().optional(),
  points: z.number().int(),
  description: z.string().min(1),
  badge_code: z.string().optional(),
  parent_summons_required: z.boolean().optional(),
  occurred_at: z.string().datetime().optional(),
});

export const UpsertAttendanceSchema = z.object({
  student_id: z.string().uuid(),
  section_id: z.string().uuid(),
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_number: z.number().int().min(0).max(20).default(0),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  source: z.enum(['MOBILE_APP', 'WEB', 'BIOMETRIC', 'RFID_GATE']).default('MOBILE_APP'),
  check_in_at: z.string().datetime().optional(),
  late_minutes: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});

export const BatchAttendanceSchema = z.object({
  entries: z.array(UpsertAttendanceSchema).min(1).max(500),
});

export const HardwareAttendanceWebhookSchema = z.object({
  device_id: z.string().min(1),
  event_type: z.enum(['CHECK_IN', 'CHECK_OUT']),
  occurred_at: z.string().datetime(),
  rfid_card_uid: z.string().optional(),
  biometric_device_user_id: z.string().optional(),
});

export const QrDismissalSchema = z.object({
  pickup_qr_token: z.string().min(10),
  student_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  notes: z.string().optional(),
});

export const UpsertBellScheduleSchema = z.object({
  branch_id: z.string().uuid(),
  name: z.string().default('Default'),
  day_of_week: z.number().int().min(0).max(6).optional(),
  morning_start: z.string().default('07:30'),
  late_after: z.string().default('08:00'),
  period_ends: z
    .array(z.object({ period: z.number().int(), end: z.string() }))
    .default([]),
});
