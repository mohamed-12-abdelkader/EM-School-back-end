import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validateParams, validateQuery } from '../middleware/validateReq';
import { asyncWrapper } from '../utils';
import * as controller from './controller';
import {
  AttendanceQuerySchema,
  ChildIdParamSchema,
  LessonIdParamSchema,
  SubjectIdParamSchema,
  SubjectIdQuerySchema,
} from './schemas';

export const router = Router();

const parentAuth = authMiddleware(['parent']);

router.get('/portal/dashboard', parentAuth, asyncWrapper(controller.getDashboard));

router.get('/portal/children', parentAuth, asyncWrapper(controller.getChildren));

router.get(
  '/portal/children/:id',
  parentAuth,
  validateParams(ChildIdParamSchema),
  asyncWrapper(controller.getChildOverview),
);

router.get(
  '/portal/children/:id/attendance',
  parentAuth,
  validateParams(ChildIdParamSchema),
  validateQuery(AttendanceQuerySchema),
  asyncWrapper(controller.getChildAttendance),
);

router.get(
  '/portal/children/:id/exams',
  parentAuth,
  validateParams(ChildIdParamSchema),
  asyncWrapper(controller.getChildExams),
);

router.get(
  '/portal/children/:id/tasks',
  parentAuth,
  validateParams(ChildIdParamSchema),
  asyncWrapper(controller.getChildTasks),
);

router.get(
  '/portal/children/:id/opinions',
  parentAuth,
  validateParams(ChildIdParamSchema),
  asyncWrapper(controller.getChildOpinions),
);

router.get(
  '/portal/children/:id/materials',
  parentAuth,
  validateParams(ChildIdParamSchema),
  asyncWrapper(controller.getChildMaterials),
);

router.get(
  '/portal/children/:id/materials/:subjectId',
  parentAuth,
  validateParams(SubjectIdParamSchema),
  asyncWrapper(controller.getChildMaterialDetail),
);

router.get(
  '/portal/children/:id/lessons',
  parentAuth,
  validateParams(ChildIdParamSchema),
  validateQuery(SubjectIdQuerySchema),
  asyncWrapper(controller.getChildLessons),
);

router.get(
  '/portal/children/:id/lessons/:lessonId',
  parentAuth,
  validateParams(LessonIdParamSchema),
  asyncWrapper(controller.getChildLessonDetail),
);
