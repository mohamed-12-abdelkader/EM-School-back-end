import { Router } from 'express';
import { asyncWrapper } from '../../utils';
import { validate } from '../../middleware/validateReq';
import { authenticateJwt } from '../../middlewares/authContext';
import { tenantContextMiddleware } from '../../middlewares/tenantContext';
import { entitlementMiddleware } from '../../middlewares/entitlement';
import { rbacMiddleware } from '../../middlewares/rbac';
import {
  AttachDocumentsSchema,
  CreateApplicationSchema,
  EnrollApplicationSchema,
  PresignDocumentSchema,
  PublicPresignDocumentSchema,
  RecordScoresSchema,
  ScheduleExamSchema,
  UpdateDocumentStatusSchema,
  UpsertSeatQuotaSchema,
} from './schemas';
import * as admissionsService from './service';
import { getTenantBySlug } from '../tenants/service';

export const admissionsRouter = Router();
export const publicAdmissionsRouter = Router();

const staff = [
  authenticateJwt,
  tenantContextMiddleware,
  entitlementMiddleware('SIS'),
  rbacMiddleware(
    ['PLATFORM_SUPER_ADMIN', 'GROUP_EXECUTIVE', 'SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'],
    'branch',
  ),
] as const;

admissionsRouter.get(
  '/applications',
  ...staff,
  asyncWrapper(async (req, res) => {
    res.json(
      await admissionsService.listApplications(
        req.context!.tenantId!,
        req.context!.branchId,
        typeof req.query.status === 'string' ? req.query.status : undefined,
      ),
    );
  }),
);

admissionsRouter.post(
  '/applications',
  ...staff,
  validate(CreateApplicationSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(await admissionsService.createApplication(req.context!.tenantId!, req.body));
  }),
);

admissionsRouter.post(
  '/applications/:id/schedule-exam',
  ...staff,
  validate(ScheduleExamSchema),
  asyncWrapper(async (req, res) => {
    res.json(
      await admissionsService.scheduleExam(req.context!.tenantId!, req.params.id, req.body),
    );
  }),
);

admissionsRouter.post(
  '/applications/:id/scores',
  ...staff,
  validate(RecordScoresSchema),
  asyncWrapper(async (req, res) => {
    res.json(await admissionsService.recordScores(req.context!.tenantId!, req.params.id, req.body));
  }),
);

admissionsRouter.post(
  '/applications/:id/accept',
  ...staff,
  asyncWrapper(async (req, res) => {
    res.json(await admissionsService.acceptOrWaitlist(req.context!.tenantId!, req.params.id));
  }),
);

admissionsRouter.post(
  '/applications/:id/enroll',
  ...staff,
  entitlementMiddleware('SIS', { checkQuota: true }),
  validate(EnrollApplicationSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(await admissionsService.enrollApplication(req.context!.tenantId!, req.params.id, req.body));
  }),
);

admissionsRouter.patch(
  '/applications/:id/documents',
  ...staff,
  validate(UpdateDocumentStatusSchema),
  asyncWrapper(async (req, res) => {
    res.json(
      await admissionsService.updateDocumentStatus(req.context!.tenantId!, req.params.id, req.body),
    );
  }),
);

admissionsRouter.post(
  '/documents/presign',
  ...staff,
  validate(PresignDocumentSchema),
  asyncWrapper(async (req, res) => {
    res.json(
      await admissionsService.presignDocument(
        req.context!.tenantId!,
        req.body.application_id,
        req.body.document_type,
        req.body.content_type,
      ),
    );
  }),
);

admissionsRouter.post(
  '/seat-quotas',
  ...staff,
  validate(UpsertSeatQuotaSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await admissionsService.upsertSeatQuota(req.context!.tenantId!, req.body));
  }),
);

/** Public catalog for apply form dropdowns */
publicAdmissionsRouter.get(
  '/:tenantSlug/catalog',
  asyncWrapper(async (req, res) => {
    const { publicTenantCatalog } = await import('../tenants/service');
    res.json(await publicTenantCatalog(req.params.tenantSlug));
  }),
);

/** Public tenant-scoped apply */
publicAdmissionsRouter.post(
  '/:tenantSlug/admissions/apply',
  validate(CreateApplicationSchema),
  asyncWrapper(async (req, res) => {
    const tenant = await getTenantBySlug(req.params.tenantSlug);
    const app = await admissionsService.createApplication(tenant.id, req.body);
    res.status(201).json({ id: app.id, status: app.status, tenant: tenant.slug });
  }),
);

publicAdmissionsRouter.post(
  '/:tenantSlug/admissions/applications/:id/documents/presign',
  validate(PublicPresignDocumentSchema),
  asyncWrapper(async (req, res) => {
    const tenant = await getTenantBySlug(req.params.tenantSlug);
    res.json(
      await admissionsService.presignDocument(
        tenant.id,
        req.params.id,
        req.body.document_type,
        req.body.content_type,
      ),
    );
  }),
);

publicAdmissionsRouter.post(
  '/:tenantSlug/admissions/applications/:id/documents',
  validate(AttachDocumentsSchema),
  asyncWrapper(async (req, res) => {
    const tenant = await getTenantBySlug(req.params.tenantSlug);
    res
      .status(201)
      .json(await admissionsService.attachDocuments(tenant.id, req.params.id, req.body.documents));
  }),
);
