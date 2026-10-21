import { z } from 'zod';
import { PLATFORM_ROLES } from '../../shared/roles';

export const LoginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(6),
  tenantId: z.string().uuid().optional(),
  role: z.enum(PLATFORM_ROLES).optional(),
}).refine((v) => !!(v.email || v.phone), { message: 'email or phone required' });

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const RegisterPlatformAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2),
});
