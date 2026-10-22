import { Router } from 'express';
import { authRouter } from '../modules/auth/routes';
import { tenantsRouter } from '../modules/tenants/routes';
import { admissionsRouter, publicAdmissionsRouter } from '../modules/admissions/routes';
import { sisRouter, webhooksRouter } from '../modules/sis/routes';
import { academicsRouter } from '../modules/academics/routes';
import { financeRouter } from '../modules/finance/routes';

export const v1Router = Router();

v1Router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    phase: 1.5,
    epics: ['1.1', '1.2', '1.3', '1.4', 'ERP'],
    modules: ['auth', 'tenants', 'admissions', 'sis', 'academics', 'finance', 'webhooks'],
  });
});

v1Router.use('/auth', authRouter);
v1Router.use('/tenants', tenantsRouter);
v1Router.use('/admissions', admissionsRouter);
v1Router.use('/sis', sisRouter);
v1Router.use('/academics', academicsRouter);
v1Router.use('/finance', financeRouter);
v1Router.use('/webhooks', webhooksRouter);
v1Router.use('/public', publicAdmissionsRouter);
