// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as express from 'express';
import { User } from './db/types';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
