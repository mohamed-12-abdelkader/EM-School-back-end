import { Router } from 'express';
import { asyncWrapper, HttpError } from '../../utils';
import { validate } from '../../middleware/validateReq';
import { authenticateJwt } from '../../middlewares/authContext';
import { tenantContextMiddleware } from '../../middlewares/tenantContext';
import { entitlementMiddleware } from '../../middlewares/entitlement';
import { rbacMiddleware } from '../../middlewares/rbac';
import { hmacWebhookMiddleware } from '../../middlewares/hmacWebhook';
import {
  BatchAttendanceSchema,
  CreateBehaviorSchema,
  CreateClinicVisitSchema,
  CreateFamilyGroupSchema,
  CreateGuardianSchema,
  CreateStudentSchema,
  HardwareAttendanceWebhookSchema,
  QrDismissalSchema,
  UpdateMedicalSchema,
  UpsertAttendanceSchema,
  UpsertBellScheduleSchema,
} from './schemas';
import * as sisService from './service';

export const sisRouter = Router();
export const webhooksRouter = Router();

const staff = [
  authenticateJwt,
  tenantContextMiddleware,
  entitlementMiddleware('SIS'),
] as const;

sisRouter.post(
  '/families',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'], 'branch'),
  validate(CreateFamilyGroupSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await sisService.createFamilyGroup(req.context!.tenantId!, req.body));
  }),
);

sisRouter.get(
  '/families/:familyGroupId/students',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER', 'TEACHER', 'PARENT'], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(
      await sisService.listFamilyStudents(req.context!.tenantId!, req.params.familyGroupId),
    );
  }),
);

sisRouter.post(
  '/guardians',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'], 'branch'),
  validate(CreateGuardianSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await sisService.createGuardian(req.context!.tenantId!, req.body));
  }),
);

sisRouter.post(
  '/students',
  ...staff,
  entitlementMiddleware('SIS', { checkQuota: true }),
  rbacMiddleware(['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'], 'branch'),
  validate(CreateStudentSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await sisService.createStudent(req.context!.tenantId!, req.body));
  }),
);

sisRouter.get(
  '/students',
  ...staff,
  rbacMiddleware(
    ['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER', 'TEACHER', 'ACADEMIC_COORDINATOR'],
    'branch',
  ),
  asyncWrapper(async (req, res) => {
    res.json(await sisService.listStudents(req.context!.tenantId!, req.context!.branchId));
  }),
);

sisRouter.get(
  '/students/:id',
  ...staff,
  rbacMiddleware(
    ['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER', 'TEACHER', 'ACADEMIC_COORDINATOR', 'PARENT'],
    'branch',
  ),
  asyncWrapper(async (req, res) => {
    res.json(await sisService.getStudent360(req.context!.tenantId!, req.params.id));
  }),
);

sisRouter.patch(
  '/students/:id/medical',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'], 'branch'),
  validate(UpdateMedicalSchema),
  asyncWrapper(async (req, res) => {
    res.json(await sisService.updateMedical(req.context!.tenantId!, req.params.id, req.body));
  }),
);

sisRouter.post(
  '/clinic-visits',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'TEACHER'], 'branch'),
  validate(CreateClinicVisitSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(
        await sisService.createClinicVisit(req.context!.tenantId!, req.context!.userId, req.body),
      );
  }),
);

sisRouter.post(
  '/behavior',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'TEACHER', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateBehaviorSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(
        await sisService.createBehaviorIncident(
          req.context!.tenantId!,
          req.context!.userId,
          req.body,
        ),
      );
  }),
);

sisRouter.post(
  '/attendance',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'TEACHER'], 'branch'),
  validate(UpsertAttendanceSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(
        await sisService.upsertAttendance(req.context!.tenantId!, req.body, req.context!.userId),
      );
  }),
);

sisRouter.post(
  '/attendance/batch',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'TEACHER'], 'branch'),
  validate(BatchAttendanceSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(
        await sisService.batchAttendance(req.context!.tenantId!, req.body, req.context!.userId),
      );
  }),
);

sisRouter.post(
  '/gate/dismissal',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'TEACHER'], 'branch'),
  validate(QrDismissalSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(
        await sisService.qrGateDismissal(req.context!.tenantId!, req.context!.userId, req.body),
      );
  }),
);

sisRouter.post(
  '/bell-schedules',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN'], 'branch'),
  validate(UpsertBellScheduleSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await sisService.upsertBellSchedule(req.context!.tenantId!, req.body));
  }),
);

sisRouter.get(
  '/parent/children',
  ...staff,
  rbacMiddleware(['PARENT'], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await sisService.parentChildren(req.context!.tenantId!, req.context!.userId));
  }),
);

sisRouter.get(
  '/parent/alerts',
  ...staff,
  rbacMiddleware(['PARENT'], 'branch'),
  asyncWrapper(async (req, res) => {
    const studentId =
      typeof req.query.student_id === 'string' ? req.query.student_id : undefined;
    res.json(
      await sisService.parentAlerts(req.context!.tenantId!, req.context!.userId, studentId),
    );
  }),
);

webhooksRouter.post(
  '/hardware/attendance',
  hmacWebhookMiddleware,
  validate(HardwareAttendanceWebhookSchema),
  asyncWrapper(async (req, res) => {
    const tenantId = req.header('x-tenant-id');
    if (!tenantId) throw new HttpError(400, 'Missing x-tenant-id');
    res.status(201).json(await sisService.ingestHardwarePunch(tenantId, req.body));
  }),
);
