import { Router } from 'express';
import { asyncWrapper } from '../../utils';
import { validate } from '../../middleware/validateReq';
import { authenticateJwt } from '../../middlewares/authContext';
import { tenantContextMiddleware } from '../../middlewares/tenantContext';
import { entitlementMiddleware } from '../../middlewares/entitlement';
import { rbacMiddleware } from '../../middlewares/rbac';
import {
  AssignMembershipSchema,
  CreateAcademicYearSchema,
  CreateBranchSchema,
  CreateGradeLevelSchema,
  CreateSectionSchema,
  CreateStreamSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
} from './schemas';
import * as tenantsService from './service';

export const tenantsRouter = Router();

const scoped = [
  authenticateJwt,
  tenantContextMiddleware,
  entitlementMiddleware('SIS'),
] as const;

tenantsRouter.post(
  '/',
  authenticateJwt,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN'], 'cross_tenant'),
  validate(CreateTenantSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.createTenant(req.body));
  }),
);

tenantsRouter.get(
  '/',
  authenticateJwt,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN', 'GROUP_EXECUTIVE'], 'cross_tenant'),
  asyncWrapper(async (_req, res) => {
    res.json(await tenantsService.listTenants());
  }),
);

/** Current-tenant resources — register before /:tenantId */
tenantsRouter.post(
  '/me/academic-years',
  ...scoped,
  rbacMiddleware(['SCHOOL_ADMIN', 'GROUP_EXECUTIVE', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateAcademicYearSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.createAcademicYear(req.context!.tenantId!, req.body));
  }),
);

tenantsRouter.get(
  '/me/academic-years',
  ...scoped,
  rbacMiddleware(
    ['SCHOOL_ADMIN', 'GROUP_EXECUTIVE', 'ACADEMIC_COORDINATOR', 'ADMISSIONS_OFFICER', 'TEACHER'],
    'branch',
  ),
  asyncWrapper(async (req, res) => {
    res.json(await tenantsService.listAcademicYears(req.context!.tenantId!));
  }),
);

tenantsRouter.post(
  '/me/streams',
  ...scoped,
  rbacMiddleware(['SCHOOL_ADMIN', 'GROUP_EXECUTIVE', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateStreamSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.createStream(req.context!.tenantId!, req.body));
  }),
);

tenantsRouter.get(
  '/me/streams',
  ...scoped,
  rbacMiddleware(
    ['SCHOOL_ADMIN', 'GROUP_EXECUTIVE', 'ACADEMIC_COORDINATOR', 'ADMISSIONS_OFFICER', 'TEACHER'],
    'branch',
  ),
  asyncWrapper(async (req, res) => {
    res.json(await tenantsService.listStreams(req.context!.tenantId!, req.context!.branchId));
  }),
);

tenantsRouter.post(
  '/me/grade-levels',
  ...scoped,
  rbacMiddleware(['SCHOOL_ADMIN', 'GROUP_EXECUTIVE', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateGradeLevelSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.createGradeLevel(req.context!.tenantId!, req.body));
  }),
);

tenantsRouter.get(
  '/me/grade-levels',
  ...scoped,
  rbacMiddleware(
    ['SCHOOL_ADMIN', 'GROUP_EXECUTIVE', 'ACADEMIC_COORDINATOR', 'ADMISSIONS_OFFICER', 'TEACHER'],
    'branch',
  ),
  asyncWrapper(async (req, res) => {
    res.json(await tenantsService.listGradeLevels(req.context!.tenantId!, req.context!.branchId));
  }),
);

tenantsRouter.post(
  '/me/sections',
  ...scoped,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateSectionSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.createSection(req.context!.tenantId!, req.body));
  }),
);

tenantsRouter.post(
  '/me/memberships',
  ...scoped,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN', 'GROUP_EXECUTIVE', 'SCHOOL_ADMIN'], 'branch'),
  validate(AssignMembershipSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.assignMembership(req.context!.tenantId!, req.body));
  }),
);

tenantsRouter.patch(
  '/:tenantId',
  authenticateJwt,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN'], 'cross_tenant'),
  validate(UpdateTenantSchema),
  asyncWrapper(async (req, res) => {
    res.json(await tenantsService.updateTenant(req.params.tenantId, req.body));
  }),
);

tenantsRouter.get(
  '/:tenantId',
  authenticateJwt,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN', 'GROUP_EXECUTIVE', 'SCHOOL_ADMIN'], 'cross_branch'),
  asyncWrapper(async (req, res) => {
    res.json(await tenantsService.getTenant(req.params.tenantId));
  }),
);

tenantsRouter.post(
  '/:tenantId/branches',
  authenticateJwt,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN', 'GROUP_EXECUTIVE', 'SCHOOL_ADMIN'], 'cross_branch'),
  validate(CreateBranchSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await tenantsService.createBranch(req.params.tenantId, req.body));
  }),
);

tenantsRouter.get(
  '/:tenantId/branches',
  authenticateJwt,
  rbacMiddleware(['PLATFORM_SUPER_ADMIN', 'GROUP_EXECUTIVE', 'SCHOOL_ADMIN'], 'cross_branch'),
  asyncWrapper(async (req, res) => {
    res.json(await tenantsService.listBranches(req.params.tenantId));
  }),
);
