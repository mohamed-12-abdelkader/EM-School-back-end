# Phase 1 API (Weeks 1–5)

Base: `http://localhost:8000/api/v1`

## Auth
- `POST /auth/login` `{ email|phone, password, tenantId?, role? }`
- `POST /auth/refresh` `{ refreshToken }`

JWT payload: `{ userId, tenantId, branchIds, role, type }`

Headers for tenant routes: `Authorization: Bearer …`, `x-tenant-id`, optional `x-branch-id`

## Tenants
- `POST|GET /tenants` — platform super admin
- `POST|GET /tenants/:id/branches`
- `POST|GET /tenants/me/academic-years|streams|grade-levels|sections|memberships`

## Admissions
- `GET|POST /admissions/applications`
- `POST /admissions/applications/:id/schedule-exam|scores|accept|enroll`
- `PATCH /admissions/applications/:id/documents`
- `POST /admissions/documents/presign`
- `POST /admissions/seat-quotas`
- `POST /public/:tenantSlug/admissions/apply` — public FR-SIS-01

## SIS
- Families, guardians, students 360°, medical, clinic, behavior
- `POST /sis/attendance` · `POST /sis/attendance/batch`
- `POST /sis/gate/dismissal` · `POST /sis/bell-schedules`
- `GET /sis/parent/children`
- `POST /webhooks/hardware/attendance` — HMAC `x-signature` + `x-tenant-id`

## Default login
`admin@emschool.local` / `admin123456` (mt_users PLATFORM_SUPER_ADMIN)
