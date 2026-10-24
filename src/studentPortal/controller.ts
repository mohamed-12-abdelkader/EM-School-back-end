import type { Request, Response } from 'express';
import * as portalChat from '../portalChat/service';
import * as studentPortalService from './service';

/** Controllers: read request → call service → send response. */

export async function getDashboard(req: Request, res: Response) {
  res.json(await studentPortalService.getDashboard(req.user));
}

export async function getSubjects(req: Request, res: Response) {
  res.json(await studentPortalService.getSubjects(req.user));
}

export async function getSubjectDetail(req: Request, res: Response) {
  res.json(await studentPortalService.getSubjectDetail(req.user, Number(req.params.id)));
}

export async function getLessons(req: Request, res: Response) {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : undefined;
  res.json(await studentPortalService.getLessons(req.user, subjectId));
}

export async function getLessonDetail(req: Request, res: Response) {
  res.json(await studentPortalService.getLessonDetail(req.user, Number(req.params.id)));
}

export async function getTasks(req: Request, res: Response) {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : undefined;
  res.json(await studentPortalService.getTasks(req.user, subjectId));
}

export async function getTaskDetail(req: Request, res: Response) {
  res.json(await studentPortalService.getTaskDetail(req.user, Number(req.params.id)));
}

export async function submitTask(req: Request, res: Response) {
  const result = await studentPortalService.submitTask(
    req.user,
    Number(req.params.id),
    req.body,
  );
  res.status(201).json(result);
}

export async function submitTaskPdf(req: Request, res: Response) {
  const result = await studentPortalService.submitTaskPdf(
    req.user,
    Number(req.params.id),
    req.body,
    req.file,
  );
  res.status(201).json(result);
}

export async function getExams(req: Request, res: Response) {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : undefined;
  res.json(await studentPortalService.getExams(req.user, subjectId));
}

export async function getExamDetail(req: Request, res: Response) {
  res.json(await studentPortalService.getExamDetail(req.user, Number(req.params.id)));
}

export async function startExam(req: Request, res: Response) {
  const result = await studentPortalService.startExam(req.user, Number(req.params.id));
  res.status(201).json(result);
}

export async function submitExam(req: Request, res: Response) {
  const result = await studentPortalService.submitExam(
    req.user,
    Number(req.params.id),
    req.body,
  );
  res.status(201).json(result);
}

export async function getExamResult(req: Request, res: Response) {
  res.json(await studentPortalService.getExamResult(req.user, Number(req.params.id)));
}

export async function getResults(req: Request, res: Response) {
  res.json(await studentPortalService.getResults(req.user));
}

export async function getNotifications(req: Request, res: Response) {
  res.json(await studentPortalService.getNotifications(req.user));
}

export async function getTimetable(req: Request, res: Response) {
  const day = req.query.day != null && req.query.day !== '' ? Number(req.query.day) : undefined;
  res.json(await studentPortalService.getTimetable(req.user, day));
}

export async function markNotificationRead(req: Request, res: Response) {
  res.json(await studentPortalService.markNotificationRead(req.user, String(req.params.id)));
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  res.json(await studentPortalService.markAllNotificationsRead(req.user));
}

export async function listChats(req: Request, res: Response) {
  res.json(await portalChat.listStudentChats(req.user));
}

export async function ensureChatWithTeacher(req: Request, res: Response) {
  res.status(201).json(
    await portalChat.ensureStudentChatWithTeacher(
      req.user,
      Number(req.body.teacher_id),
    ),
  );
}

export async function getChatMessages(req: Request, res: Response) {
  res.json(await portalChat.getStudentMessages(req.user, Number(req.params.id)));
}

export async function sendChatMessage(req: Request, res: Response) {
  res.status(201).json(
    await portalChat.sendStudentMessage(
      req.user,
      Number(req.params.id),
      String(req.body.text || ''),
    ),
  );
}
