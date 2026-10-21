import { z } from 'zod';

export const RegisterStudent = z.object({
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number'),
  password: z.string().min(6),
  name: z.string().min(1),
  grade_id: z.number(),
});

export const RegisterAdminOrTeacher = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
      .optional(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: z.enum(['admin', 'teacher']),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Either email or phone must be provided',
  });

export const Login = z
  .object({
    email: z.string().email().optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{8,15}$/, 'Invalid phone number')
      .optional(),
    password: z.string(),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Either email or phone must be provided',
  });

/** Student/parent portal login using school code + 5-digit login code */
export const LoginByCode = z.object({
  school_code: z.string().trim().min(3).max(16),
  login_code: z.string().regex(/^\d{5}$/, 'Login code must be exactly 5 digits'),
  role: z.enum(['student', 'parent']),
});

/** Student-only login: 5-digit student code (globally unique) */
export const LoginStudentByCode = z.object({
  login_code: z.string().regex(/^\d{5}$/, 'Login code must be exactly 5 digits'),
});

export const ForgotPassword = z.object({
  email: z.string().email(),
});

export const ResetPassword = z.object({
  token: z.string(),
  password: z.string().min(6),
});

export const ChangePassword = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(8).optional(),
    new_password: z.string().min(6),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Either email or phone is required',
  });
