import { Router } from 'express';
import { asyncWrapper } from '../../utils';
import { validate } from '../../middleware/validateReq';
import { LoginSchema, RefreshSchema } from './schemas';
import * as authService from './service';

export const authRouter = Router();

authRouter.post(
  '/login',
  validate(LoginSchema),
  asyncWrapper(async (req, res) => {
    const result = await authService.login(req.body);
    res.json(result);
  }),
);

authRouter.post(
  '/refresh',
  validate(RefreshSchema),
  asyncWrapper(async (req, res) => {
    const result = await authService.refresh(req.body.refreshToken);
    res.json(result);
  }),
);
