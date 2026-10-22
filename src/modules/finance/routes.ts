import { Router } from 'express';
import { asyncWrapper } from '../../utils';
import { validate } from '../../middleware/validateReq';
import { authenticateJwt } from '../../middlewares/authContext';
import { tenantContextMiddleware } from '../../middlewares/tenantContext';
import { entitlementMiddleware } from '../../middlewares/entitlement';
import { rbacMiddleware } from '../../middlewares/rbac';
import {
  AssignStructureSchema,
  CreateCategorySchema,
  CreateStructureSchema,
  RecordPaymentSchema,
} from './schemas';
import * as financeService from './service';

export const financeRouter = Router();

const staff = [
  authenticateJwt,
  tenantContextMiddleware,
  entitlementMiddleware('FINANCE'),
] as const;

const financeRoles = [
  'SCHOOL_ADMIN',
  'FINANCE_MANAGER',
  'GROUP_EXECUTIVE',
  'ADMISSIONS_OFFICER',
] as const;

financeRouter.get(
  '/summary',
  ...staff,
  rbacMiddleware([...financeRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await financeService.financeSummary(req.context!.tenantId!));
  }),
);

financeRouter.get(
  '/categories',
  ...staff,
  rbacMiddleware([...financeRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await financeService.listCategories(req.context!.tenantId!));
  }),
);

financeRouter.post(
  '/categories',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'FINANCE_MANAGER'], 'branch'),
  validate(CreateCategorySchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(await financeService.createCategory(req.context!.tenantId!, req.body));
  }),
);

financeRouter.get(
  '/structures',
  ...staff,
  rbacMiddleware([...financeRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(
      await financeService.listStructures(req.context!.tenantId!, req.context!.userId),
    );
  }),
);

financeRouter.post(
  '/structures',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'FINANCE_MANAGER'], 'branch'),
  validate(CreateStructureSchema),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(
        await financeService.createStructure(
          req.context!.tenantId!,
          req.context!.userId,
          req.body,
        ),
      );
  }),
);

financeRouter.post(
  '/structures/:id/assign',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'FINANCE_MANAGER'], 'branch'),
  validate(AssignStructureSchema),
  asyncWrapper(async (req, res) => {
    res.json(
      await financeService.assignStructure(req.context!.tenantId!, req.params.id, req.body),
    );
  }),
);

financeRouter.get(
  '/accounts',
  ...staff,
  rbacMiddleware([...financeRoles], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(await financeService.listAccounts(req.context!.tenantId!));
  }),
);

financeRouter.get(
  '/installments',
  ...staff,
  rbacMiddleware([...financeRoles, 'PARENT'], 'branch'),
  asyncWrapper(async (req, res) => {
    res.json(
      await financeService.listInstallments(req.context!.tenantId!, {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        studentId: typeof req.query.student_id === 'string' ? req.query.student_id : undefined,
      }),
    );
  }),
);

financeRouter.post(
  '/payments',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'FINANCE_MANAGER'], 'branch'),
  validate(RecordPaymentSchema),
  asyncWrapper(async (req, res) => {
    res.status(201).json(
      await financeService.recordPayment(
        req.context!.tenantId!,
        req.context!.userId,
        req.body,
      ),
    );
  }),
);

financeRouter.post(
  '/seed-defaults',
  ...staff,
  rbacMiddleware(['SCHOOL_ADMIN', 'FINANCE_MANAGER'], 'branch'),
  asyncWrapper(async (req, res) => {
    res
      .status(201)
      .json(await financeService.seedDefaultFees(req.context!.tenantId!, req.context!.userId));
  }),
);
