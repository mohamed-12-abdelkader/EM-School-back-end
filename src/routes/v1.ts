import { Router } from 'express';
import { authRouter } from '../modules/auth/routes';
import { tenantsRouter } from '../modules/tenants/routes';
import { admissionsRouter, publicAdmissionsRouter } from '../modules/admissions/routes';
import { sisRouter, webhooksRouter } from '../modules/sis/routes';

export const v1Router = Router();

v1Router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    phase: 1,
    epics: ['1.1', '1.2', '1.3', '1.4'],
    modules: ['auth', 'tenants', 'admissions', 'sis', 'webhooks'],
  });
});

v1Router.use('/auth', authRouter);
v1Router.use('/tenants', tenantsRouter);
v1Router.use('/admissions', admissionsRouter);
v1Router.use('/sis', sisRouter);
v1Router.use('/webhooks', webhooksRouter);
v1Router.use('/public', publicAdmissionsRouter);
