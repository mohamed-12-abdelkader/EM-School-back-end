import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate, validateParams, validateQuery } from '../middleware/validateReq';
import { materialUpload } from '../teacherPortal/upload';
import { asyncWrapper } from '../utils';
import * as controller from './controller';
import {
  IdParamSchema,
  SubjectIdQuerySchema,
  SubmitExamSchema,
  SubmitTaskPdfSchema,
  SubmitTaskSchema,
  TimetableQuerySchema,
} from './schemas';

/**
 * Route + Middleware
 * Authentication, role checks, input validation → controller
 */
export const router = Router();

const studentAuth = authMiddleware(['student']);

router.get('/portal/dashboard', studentAuth, asyncWrapper(controller.getDashboard));

router.get('/portal/subjects', studentAuth, asyncWrapper(controller.getSubjects));

router.get(
  '/portal/subjects/:id',
  studentAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getSubjectDetail),
);

router.get(
  '/portal/lessons',
  studentAuth,
  validateQuery(SubjectIdQuerySchema),
  asyncWrapper(controller.getLessons),
);

router.get(
  '/portal/lessons/:id',
  studentAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getLessonDetail),
);

router.get(
  '/portal/tasks',
  studentAuth,
  validateQuery(SubjectIdQuerySchema),
  asyncWrapper(controller.getTasks),
);

router.get(
  '/portal/tasks/:id',
  studentAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getTaskDetail),
);

router.post(
  '/portal/tasks/:id/submit',
  studentAuth,
  validateParams(IdParamSchema),
  validate(SubmitTaskSchema),
  asyncWrapper(controller.submitTask),
);

router.post(
  '/portal/tasks/:id/submit-pdf',
  studentAuth,
  validateParams(IdParamSchema),
  materialUpload.single('file'),
  validate(SubmitTaskPdfSchema),
  asyncWrapper(controller.submitTaskPdf),
);

router.get(
  '/portal/exams',
  studentAuth,
  validateQuery(SubjectIdQuerySchema),
  asyncWrapper(controller.getExams),
);

router.get(
  '/portal/exams/:id',
  studentAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getExamDetail),
);

router.post(
  '/portal/exams/:id/submit',
  studentAuth,
  validateParams(IdParamSchema),
  validate(SubmitExamSchema),
  asyncWrapper(controller.submitExam),
);

router.get(
  '/portal/exams/:id/result',
  studentAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getExamResult),
);

router.get('/portal/results', studentAuth, asyncWrapper(controller.getResults));

router.get('/portal/notifications', studentAuth, asyncWrapper(controller.getNotifications));

router.get(
  '/portal/timetable',
  studentAuth,
  validateQuery(TimetableQuerySchema),
  asyncWrapper(controller.getTimetable),
);

router.post(
  '/portal/notifications/:id/read',
  studentAuth,
  asyncWrapper(controller.markNotificationRead),
);

router.post(
  '/portal/notifications/read-all',
  studentAuth,
  asyncWrapper(controller.markAllNotificationsRead),
);
