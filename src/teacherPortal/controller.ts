import type { Request, Response } from 'express';
import * as portalChat from '../portalChat/service';
import * as teacherPortalService from './service';

/** Controllers: read request → call service → send response. */

export async function getDashboard(req: Request, res: Response) {
  res.json(await teacherPortalService.getDashboard(req.user));
}

export async function getClasses(req: Request, res: Response) {
  res.json(await teacherPortalService.getClasses(req.user));
}

export async function getClassDetail(req: Request, res: Response) {
  const classroomId = Number(req.params.classroomId);
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : undefined;
  res.json(await teacherPortalService.getClassDetail(req.user, classroomId, subjectId));
}

export async function getLessons(req: Request, res: Response) {
  const classroomId = req.query.classroom_id ? Number(req.query.classroom_id) : undefined;
  res.json(await teacherPortalService.getLessons(req.user, classroomId));
}

export async function getLessonDetail(req: Request, res: Response) {
  res.json(await teacherPortalService.getLessonDetail(req.user, req.params.id));
}

export async function createLesson(req: Request, res: Response) {
  const result = await teacherPortalService.createLesson(req.user, req.body);
  res.status(201).json(result);
}

export async function updateLesson(req: Request, res: Response) {
  res.json(await teacherPortalService.updateLesson(req.user, req.params.id, req.body));
}

export async function deleteLesson(req: Request, res: Response) {
  res.json(await teacherPortalService.deleteLesson(req.user, req.params.id));
}

export async function addLessonAttachment(req: Request, res: Response) {
  const result = await teacherPortalService.addLessonAttachment(
    req.user,
    req.params.id,
    req.body,
    req.file,
  );
  res.status(201).json(result);
}

export async function updateLessonAttachment(req: Request, res: Response) {
  res.json(
    await teacherPortalService.updateLessonAttachment(
      req.user,
      req.params.lessonId,
      req.params.attachmentId,
      req.body,
      req.file,
    ),
  );
}

export async function deleteLessonAttachment(req: Request, res: Response) {
  res.json(
    await teacherPortalService.deleteLessonAttachment(
      req.user,
      req.params.lessonId,
      req.params.attachmentId,
    ),
  );
}

export async function getExams(req: Request, res: Response) {
  res.json(await teacherPortalService.getExams(req.user));
}

export async function getExamDetail(req: Request, res: Response) {
  res.json(await teacherPortalService.getExamDetail(req.user, req.params.id));
}

export async function createExam(req: Request, res: Response) {
  const result = await teacherPortalService.createExam(req.user, req.body);
  res.status(201).json(result);
}

export async function updateExam(req: Request, res: Response) {
  res.json(await teacherPortalService.updateExam(req.user, req.params.id, req.body));
}

export async function deleteExam(req: Request, res: Response) {
  res.json(await teacherPortalService.deleteExam(req.user, req.params.id));
}

export async function getTasks(req: Request, res: Response) {
  res.json(await teacherPortalService.getTasks(req.user));
}

export async function getTaskDetail(req: Request, res: Response) {
  res.json(await teacherPortalService.getTaskDetail(req.user, req.params.id));
}

export async function createTask(req: Request, res: Response) {
  const result = await teacherPortalService.createTask(req.user, req.body);
  res.status(201).json(result);
}

export async function addTaskAttachment(req: Request, res: Response) {
  const result = await teacherPortalService.addTaskAttachment(
    req.user,
    req.params.id,
    req.body,
    req.file,
  );
  res.status(201).json(result);
}

export async function deleteTaskAttachment(req: Request, res: Response) {
  res.json(
    await teacherPortalService.deleteTaskAttachment(
      req.user,
      req.params.taskId,
      req.params.attachmentId,
    ),
  );
}

export async function updateTask(req: Request, res: Response) {
  res.json(await teacherPortalService.updateTask(req.user, req.params.id, req.body));
}

export async function deleteTask(req: Request, res: Response) {
  res.json(await teacherPortalService.deleteTask(req.user, req.params.id));
}

export async function upsertTaskGrade(req: Request, res: Response) {
  res.json(await teacherPortalService.upsertTaskGrade(req.user, req.params.id, req.body));
}

export async function listChats(req: Request, res: Response) {
  res.json(await portalChat.listTeacherChats(req.user));
}

export async function ensureChatWithStudent(req: Request, res: Response) {
  res.status(201).json(
    await portalChat.ensureTeacherChatWithStudent(
      req.user,
      Number(req.body.student_id),
    ),
  );
}

export async function getChatMessages(req: Request, res: Response) {
  res.json(await portalChat.getTeacherMessages(req.user, Number(req.params.id)));
}

export async function sendChatMessage(req: Request, res: Response) {
  res.status(201).json(
    await portalChat.sendTeacherMessage(
      req.user,
      Number(req.params.id),
      String(req.body.text || ''),
    ),
  );
}

export async function listStudentOpinions(req: Request, res: Response) {
  res.json(
    await teacherPortalService.listStudentOpinions(
      req.user,
      Number(req.params.studentId),
      Number(req.query.classroom_id),
    ),
  );
}

export async function createStudentOpinion(req: Request, res: Response) {
  res.status(201).json(await teacherPortalService.createStudentOpinion(req.user, req.body));
}

export async function updateStudentOpinion(req: Request, res: Response) {
  res.json(
    await teacherPortalService.updateStudentOpinion(
      req.user,
      Number(req.params.id),
      req.body,
    ),
  );
}

export async function deleteStudentOpinion(req: Request, res: Response) {
  res.json(await teacherPortalService.deleteStudentOpinion(req.user, Number(req.params.id)));
}
