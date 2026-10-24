import type { Request, Response } from 'express';
import * as parentPortalService from './service';

export async function getDashboard(req: Request, res: Response) {
  res.json(await parentPortalService.getDashboard(req.user));
}

export async function getChildren(req: Request, res: Response) {
  res.json(await parentPortalService.getChildren(req.user));
}

export async function getChildOverview(req: Request, res: Response) {
  res.json(await parentPortalService.getChildOverview(req.user, Number(req.params.id)));
}

export async function getChildAttendance(req: Request, res: Response) {
  const dateFrom =
    typeof req.query.date_from === 'string' ? req.query.date_from : undefined;
  const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : undefined;
  res.json(
    await parentPortalService.getChildAttendance(
      req.user,
      Number(req.params.id),
      dateFrom,
      dateTo,
    ),
  );
}

export async function getChildExams(req: Request, res: Response) {
  res.json(await parentPortalService.getChildExams(req.user, Number(req.params.id)));
}

export async function getChildTasks(req: Request, res: Response) {
  res.json(await parentPortalService.getChildTasks(req.user, Number(req.params.id)));
}

export async function getChildOpinions(req: Request, res: Response) {
  res.json(await parentPortalService.getChildOpinions(req.user, Number(req.params.id)));
}

export async function getChildLessons(req: Request, res: Response) {
  const subjectId = req.query.subject_id ? Number(req.query.subject_id) : undefined;
  res.json(
    await parentPortalService.getChildLessons(req.user, Number(req.params.id), subjectId),
  );
}

export async function getChildMaterials(req: Request, res: Response) {
  res.json(await parentPortalService.getChildMaterials(req.user, Number(req.params.id)));
}

export async function getChildMaterialDetail(req: Request, res: Response) {
  res.json(
    await parentPortalService.getChildMaterialDetail(
      req.user,
      Number(req.params.id),
      Number(req.params.subjectId),
    ),
  );
}

export async function getChildLessonDetail(req: Request, res: Response) {
  res.json(
    await parentPortalService.getChildLessonDetail(
      req.user,
      Number(req.params.id),
      Number(req.params.lessonId),
    ),
  );
}
