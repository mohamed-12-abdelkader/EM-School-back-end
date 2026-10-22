import { Router } from 'express';
import { asyncWrapper, HttpError } from '../../utils';
import { validate } from '../../middleware/validateReq';
import { authenticateJwt } from '../../middlewares/authContext';
import { tenantContextMiddleware } from '../../middlewares/tenantContext';
import { entitlementMiddleware } from '../../middlewares/entitlement';
import { rbacMiddleware } from '../../middlewares/rbac';
import {
  CreateSubjectSchema,
  CreateTimetableSchema,
  ReplaceSlotsSchema,
  UpsertTimetableSettingsSchema,
} from './schemas';
import * as academicsService from './service';

export const academicsRouter = Router();

const staff = [
  authenticateJwt,
  tenantContextMiddleware,
  entitlementMiddleware('SIS'),
] as const;

const academicRoles = [
  'SCHOOL_ADMIN',
  'ACADEMIC_COORDINATOR',
  'GROUP_EXECUTIVE',
  'TEACHER',
] as const;

academicsRouter.get(
  '/timetable/settings',
  ...staff,
  rbacMiddleware([...academicRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await academicsService.getSettings(req.context!.tenantId!, req.context!.branchId));
  }),
);

academicsRouter.put(
  '/timetable/settings',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(UpsertTimetableSettingsSchema),
  asyncWrapper(async (req, res) => {
    res.json(
      await academicsService.updateSettings(
        req.context!.tenantId!,
        req.context!.branchId,
        req.body,
      ),
    );
  }),
);

academicsRouter.get(
  '/subjects',
  ...staff,
  rbacMiddleware([...academicRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(
      await academicsService.listSubjects(req.context!.tenantId!, req.context!.branchId),
    );
  }),
);

academicsRouter.post(
  '/subjects',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateSubjectSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await academicsService.createSubject(req.context!.tenantId!, req.body));
  }),
);

academicsRouter.post(
  '/subjects/seed-defaults',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  asyncWrapper(async (req, res) => {
    res.status(201).json(
      await academicsService.seedDefaultSubjects(req.context!.tenantId!, req.context!.branchId),
    );
  }),
);

academicsRouter.get(
  '/timetables',
  ...staff,
  rbacMiddleware([...academicRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await academicsService.listTimetables(req.context!.tenantId!, req.context!.branchId));
  }),
);

academicsRouter.post(
  '/timetables',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(CreateTimetableSchema),
  asyncWrapper(async (req, res) => {
    const branchId = req.context!.branchId;
    if (!branchId) throw new HttpError(400, 'x-branch-id required');
    res.status(201).json(
      await academicsService.createTimetable(
        req.context!.tenantId!,
        branchId,
        req.context!.userId,
        req.body,
      ),
    );
  }),
);

academicsRouter.get(
  '/timetables/:id',
  ...staff,
  rbacMiddleware([...academicRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await academicsService.getTimetable(req.context!.tenantId!, req.params.id));
  }),
);

academicsRouter.put(
  '/timetables/:id/slots',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  validate(ReplaceSlotsSchema),
  asyncWrapper(async (req, res) => {
    res.json(
      await academicsService.replaceSlots(req.context!.tenantId!, req.params.id, req.body),
    );
  }),
);

academicsRouter.post(
  '/timetables/:id/publish',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'ACADEMIC_COORDINATOR'], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await academicsService.publishTimetable(req.context!.tenantId!, req.params.id));
  }),
);
