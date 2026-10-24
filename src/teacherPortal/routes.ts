import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate, validateParams, validateQuery } from '../middleware/validateReq';
import { asyncWrapper } from '../utils';
import * as controller from './controller';
import {
  AddAttachmentSchema,
  AddTaskAttachmentSchema,
  CreateExamSchema,
  CreateLessonSchema,
  CreateTaskSchema,
  UpdateAttachmentSchema,
  UpdateExamSchema,
  UpdateLessonSchema,
  UpdateTaskSchema,
  UpsertTaskGradeSchema,
  CreateStudentOpinionSchema,
  UpdateStudentOpinionSchema,
  StudentOpinionsQuerySchema,
} from './schemas';
import { materialUpload } from './upload';
import { z } from 'zod';

/**
 * Route + Middleware
 * Authentication, role checks, input validation → controller
 */
export const router = Router();

const teacherAuth = authMiddleware(['teacher']);

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const ClassroomIdParamSchema = z.object({
  classroomId: z.coerce.number().int().positive(),
});

const LessonAttachmentParamsSchema = z.object({
  lessonId: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive(),
});

const TaskAttachmentParamsSchema = z.object({
  taskId: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive(),
});

const ClassDetailQuerySchema = z.object({
  subject_id: z.coerce.number().int().positive().optional(),
});

const LessonsQuerySchema = z.object({
  classroom_id: z.coerce.number().int().positive().optional(),
});

router.get('/portal/dashboard', teacherAuth, asyncWrapper(controller.getDashboard));

router.get('/portal/classes', teacherAuth, asyncWrapper(controller.getClasses));

router.get(
  '/portal/classes/:classroomId',
  teacherAuth,
  validateParams(ClassroomIdParamSchema),
  validateQuery(ClassDetailQuerySchema),
  asyncWrapper(controller.getClassDetail),
);

router.get(
  '/portal/lessons',
  teacherAuth,
  validateQuery(LessonsQuerySchema),
  asyncWrapper(controller.getLessons),
);

router.get(
  '/portal/lessons/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getLessonDetail),
);

router.post(
  '/portal/lessons',
  teacherAuth,
  validate(CreateLessonSchema),
  asyncWrapper(controller.createLesson),
);

router.patch(
  '/portal/lessons/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  validate(UpdateLessonSchema),
  asyncWrapper(controller.updateLesson),
);

router.delete(
  '/portal/lessons/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.deleteLesson),
);

router.post(
  '/portal/lessons/:id/attachments',
  teacherAuth,
  validateParams(IdParamSchema),
  materialUpload.single('file'),
  validate(AddAttachmentSchema),
  asyncWrapper(controller.addLessonAttachment),
);

router.patch(
  '/portal/lessons/:lessonId/attachments/:attachmentId',
  teacherAuth,
  validateParams(LessonAttachmentParamsSchema),
  materialUpload.single('file'),
  validate(UpdateAttachmentSchema),
  asyncWrapper(controller.updateLessonAttachment),
);

router.delete(
  '/portal/lessons/:lessonId/attachments/:attachmentId',
  teacherAuth,
  validateParams(LessonAttachmentParamsSchema),
  asyncWrapper(controller.deleteLessonAttachment),
);

router.get('/portal/exams', teacherAuth, asyncWrapper(controller.getExams));

router.get(
  '/portal/exams/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getExamDetail),
);

router.post(
  '/portal/exams',
  teacherAuth,
  validate(CreateExamSchema),
  asyncWrapper(controller.createExam),
);

router.patch(
  '/portal/exams/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  validate(UpdateExamSchema),
  asyncWrapper(controller.updateExam),
);

router.delete(
  '/portal/exams/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.deleteExam),
);

router.get('/portal/tasks', teacherAuth, asyncWrapper(controller.getTasks));

router.get(
  '/portal/tasks/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getTaskDetail),
);

router.post(
  '/portal/tasks',
  teacherAuth,
  validate(CreateTaskSchema),
  asyncWrapper(controller.createTask),
);

router.post(
  '/portal/tasks/:id/attachments',
  teacherAuth,
  validateParams(IdParamSchema),
  materialUpload.single('file'),
  validate(AddTaskAttachmentSchema),
  asyncWrapper(controller.addTaskAttachment),
);

router.delete(
  '/portal/tasks/:taskId/attachments/:attachmentId',
  teacherAuth,
  validateParams(TaskAttachmentParamsSchema),
  asyncWrapper(controller.deleteTaskAttachment),
);

router.patch(
  '/portal/tasks/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  validate(UpdateTaskSchema),
  asyncWrapper(controller.updateTask),
);

router.delete(
  '/portal/tasks/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.deleteTask),
);

router.put(
  '/portal/tasks/:id/grades',
  teacherAuth,
  validateParams(IdParamSchema),
  validate(UpsertTaskGradeSchema),
  asyncWrapper(controller.upsertTaskGrade),
);

const EnsureStudentChatSchema = z.object({
  student_id: z.coerce.number().int().positive(),
});

const SendChatMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

router.get('/portal/chats', teacherAuth, asyncWrapper(controller.listChats));

router.post(
  '/portal/chats',
  teacherAuth,
  validate(EnsureStudentChatSchema),
  asyncWrapper(controller.ensureChatWithStudent),
);

router.get(
  '/portal/chats/:id/messages',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.getChatMessages),
);

router.post(
  '/portal/chats/:id/messages',
  teacherAuth,
  validateParams(IdParamSchema),
  validate(SendChatMessageSchema),
  asyncWrapper(controller.sendChatMessage),
);

const StudentIdParamSchema = z.object({
  studentId: z.coerce.number().int().positive(),
});

router.get(
  '/portal/students/:studentId/opinions',
  teacherAuth,
  validateParams(StudentIdParamSchema),
  validateQuery(StudentOpinionsQuerySchema),
  asyncWrapper(controller.listStudentOpinions),
);

router.post(
  '/portal/opinions',
  teacherAuth,
  validate(CreateStudentOpinionSchema),
  asyncWrapper(controller.createStudentOpinion),
);

router.patch(
  '/portal/opinions/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  validate(UpdateStudentOpinionSchema),
  asyncWrapper(controller.updateStudentOpinion),
);

router.delete(
  '/portal/opinions/:id',
  teacherAuth,
  validateParams(IdParamSchema),
  asyncWrapper(controller.deleteStudentOpinion),
);
