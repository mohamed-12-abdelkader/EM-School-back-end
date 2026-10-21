# EM School API (PRD v2)

Multi-tenant K-12 SIS / LMS / ERP backend: **Node.js + Express + TypeScript + Zod**, PostgreSQL on **Supabase**, async jobs via **BullMQ + Redis**.

Docker is **not** used. Point `DATABASE_URL` at Supabase and `REDIS_URL` at a managed or local Redis instance.

## Quick start

```bash
cp .env.example .env
# fill DATABASE_URL (Supabase) and REDIS_URL

npm install
npm run dev
```

- API: `http://localhost:8000/api`
- PRD Phase 1 health: `http://localhost:8000/api/v1/health`
- Migrations run automatically on boot

## Layout (PRD §6.1)

```text
src/
├── config/               # Zod env, Redis
├── middlewares/          # Tenant entitlements
├── modules/
│   ├── tenants/          # SaaS provisioning, branches, streams
│   ├── admissions/       # Applications & enrollment
│   ├── sis/              # Students, attendance, hardware webhooks
│   ├── academics/        # (Phase 2)
│   ├── finance/          # (Phase 3)
│   ├── hr-payroll/       # (Phase 3)
│   ├── operations/       # (Phase 4)
│   └── communications/   # (Phase 4)
└── workers/              # BullMQ processors
```

Legacy `/api/school/*` routes remain while modules migrate to `/api/v1/*`.

## Phase 1 endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/health` | Phase marker |
| POST/GET | `/api/v1/tenants` | Super admin |
| POST/GET | `/api/v1/tenants/:id/branches` | Branches |
| POST | `/api/v1/tenants/streams` | Requires `x-tenant-id` |
| GET/POST | `/api/v1/tenants/grade-levels` | Requires `x-tenant-id` |
| GET/POST | `/api/v1/admissions/applications` | Admissions pipeline |
| PATCH | `/api/v1/admissions/applications/:id/status` | Waitlist / enroll |
| GET/POST | `/api/v1/sis/students` | Student profiles |
| POST | `/api/v1/sis/attendance` | Daily / period attendance |
| POST | `/api/v1/sis/webhooks/hardware/attendance` | RFID / biometric (HMAC) |

Tenant-scoped routes expect header `x-tenant-id` (and optional `x-branch-id`).
