export const PLATFORM_ROLES = [
  'PLATFORM_SUPER_ADMIN',
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
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type RbacScope = 'cross_tenant' | 'cross_branch' | 'branch';

export const ROLE_SCOPE: Record<PlatformRole, RbacScope> = {
  PLATFORM_SUPER_ADMIN: 'cross_tenant',
  GROUP_EXECUTIVE: 'cross_branch',
  SCHOOL_ADMIN: 'branch',
  ADMISSIONS_OFFICER: 'branch',
  ACADEMIC_COORDINATOR: 'branch',
  FINANCE_MANAGER: 'branch',
  HR_SPECIALIST: 'branch',
  LIBRARIAN: 'branch',
  TRANSPORT_MANAGER: 'branch',
  TEACHER: 'branch',
  PARENT: 'branch',
  STUDENT: 'branch',
};

export type JwtAuthPayload = {
  sub: string;
  userId: string;
  tenantId: string | null;
  branchIds: string[];
  role: PlatformRole;
  type: 'access' | 'refresh';
  jti?: string;
};
