import type { User } from '../db/types';
import { calcAttendanceRate } from '../services/attendance';
import { HttpError } from '../utils';
import * as repo from './repository';
import type { ChildCtx, ParentCtx } from './types';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Default window: last ~6 months through today. */
export function defaultAttendanceRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  return { dateFrom: isoDate(from), dateTo: isoDate(to) };
}

export async function requireParentCtx(user: User | undefined): Promise<ParentCtx> {
  if (!user?.school_id) throw new HttpError(403, 'Parent is not linked to a school');
  if (user.role !== 'parent') throw new HttpError(403, 'Parent access required');
  return { parentId: user.id, schoolId: user.school_id };
}

async function requireChildCtx(
  user: User | undefined,
  studentId: number,
): Promise<ChildCtx> {
  const parent = await requireParentCtx(user);
  if (!Number.isFinite(studentId) || studentId <= 0) {
    throw new HttpError(400, 'Invalid student id');
  }
  const result = await repo.findLinkedChild(parent.parentId, parent.schoolId, studentId);
  if (!result.rowCount) throw new HttpError(404, 'Child not found');
  const row = result.rows[0];
  if (row.status !== 'active') throw new HttpError(403, 'Student account is not active');
  return {
    parentId: parent.parentId,
    schoolId: parent.schoolId,
    studentId: row.student_id,
    classroomId: row.classroom_id,
    gradeId: row.grade_id,
    academicYear: row.academic_year,
    gradeName: row.grade_name,
    classroomName: row.classroom_name,
    studentName: row.student_name,
    relation: row.relation,
    isPrimary: !!row.is_primary,
    avatar: row.avatar || null,
  };
}

function mapChild(row: Record<string, unknown>) {
  return {
    id: String(row.student_id),
    name: row.student_name as string,
    avatar: (row.avatar as string | null) || null,
    relation: row.relation as string,
    isPrimary: !!row.is_primary,
    status: row.status as string,
    academicYear: (row.academic_year as string) || null,
    gradeId: row.grade_id != null ? String(row.grade_id) : null,
    gradeName: (row.grade_name as string) || null,
    classroomId: row.classroom_id != null ? String(row.classroom_id) : null,
    classroomName: (row.classroom_name as string) || null,
    seatNumber: (row.seat_number as string) || null,
  };
}

function attendancePayload(
  row: {
    present_days: number;
    absent_days: number;
    late_days: number;
    excused_days: number;
    recorded_days: number;
  },
  dateFrom: string,
  dateTo: string,
) {
  const presentLike = row.present_days + row.late_days;
  return {
    dateFrom,
    dateTo,
    presentDays: row.present_days,
    absentDays: row.absent_days,
    lateDays: row.late_days,
    excusedDays: row.excused_days,
    recordedDays: row.recorded_days,
    attendanceRate: calcAttendanceRate(presentLike, row.recorded_days),
  };
}

export async function getDashboard(user: User | undefined) {
  const ctx = await requireParentCtx(user);
  const [schoolRes, childrenRes] = await Promise.all([
    repo.findSchool(ctx.schoolId),
    repo.listChildren(ctx.parentId, ctx.schoolId),
  ]);
  const school = schoolRes.rows[0];
  const { dateFrom, dateTo } = defaultAttendanceRange();

  const children = await Promise.all(
    childrenRes.rows.map(async (row) => {
      const child = mapChild(row);
      const [att, exams, tasks, opinions] = await repo.queryChildDashboardStats(
        row.student_id,
        ctx.schoolId,
        row.classroom_id,
        dateFrom,
        dateTo,
      );
      const attRow = att.rows[0];
      return {
        ...child,
        stats: {
          ...attendancePayload(attRow, dateFrom, dateTo),
          avgExamPercent: Math.round(Number(exams.rows[0].avg_pct) || 0),
          examAttempts: exams.rows[0].attempts_count as number,
          gradedTasks: tasks.rows[0].c as number,
          teacherOpinions: opinions.rows[0].c as number,
        },
      };
    }),
  );

  return {
    parent: {
      id: String(ctx.parentId),
      name: user!.name,
      phone: user!.phone ?? null,
    },
    school: school
      ? {
          id: String(school.id),
          name: school.name,
          loginCode: school.login_code,
          logo: school.logo || null,
        }
      : null,
    children,
    attendanceWindow: { dateFrom, dateTo },
  };
}

export async function getChildren(user: User | undefined) {
  const ctx = await requireParentCtx(user);
  const result = await repo.listChildren(ctx.parentId, ctx.schoolId);
  return { children: result.rows.map(mapChild) };
}

export async function getChildOverview(user: User | undefined, studentId: number) {
  const child = await requireChildCtx(user, studentId);
  const { dateFrom, dateTo } = defaultAttendanceRange();
  const empty = { rows: [] as Record<string, unknown>[] };

  const [statsTuple, recentAtt, examRows, taskRows, opinionRows] = await Promise.all([
    repo.queryChildDashboardStats(
      child.studentId,
      child.schoolId,
      child.classroomId,
      dateFrom,
      dateTo,
    ),
    repo.listAttendanceRecords(child.studentId, child.schoolId, dateFrom, dateTo, 8),
    child.classroomId
      ? repo.listExamResults(child.studentId, child.classroomId)
      : Promise.resolve(empty),
    child.classroomId
      ? repo.listTaskGrades(child.studentId, child.classroomId)
      : Promise.resolve(empty),
    repo.listTeacherOpinions(child.studentId, child.schoolId),
  ]);

  const [attRes, examStats, taskStats, opinionStats] = statsTuple;

  return {
    child: {
      id: String(child.studentId),
      name: child.studentName,
      avatar: child.avatar,
      relation: child.relation,
      isPrimary: child.isPrimary,
      academicYear: child.academicYear,
      gradeName: child.gradeName,
      classroomName: child.classroomName,
    },
    stats: {
      ...attendancePayload(attRes.rows[0], dateFrom, dateTo),
      avgExamPercent: Math.round(Number(examStats.rows[0].avg_pct) || 0),
      examAttempts: examStats.rows[0].attempts_count as number,
      gradedTasks: taskStats.rows[0].c as number,
      teacherOpinions: opinionStats.rows[0].c as number,
    },
    recentAttendance: recentAtt.rows.map((r) => ({
      id: String(r.id),
      date: String(r.attendance_date).slice(0, 10),
      status: r.status,
      checkInTime: r.check_in_time || null,
      notes: r.notes || null,
    })),
    recentExams: examRows.rows.slice(0, 5).map(mapExam),
    recentTasks: taskRows.rows.slice(0, 5).map(mapTask),
    recentOpinions: opinionRows.rows.slice(0, 5).map(mapOpinion),
  };
}

function mapExam(a: Record<string, unknown>) {
  const score = Number(a.score);
  const maxScore = Number(a.max_score);
  return {
    id: String(a.id),
    examId: String(a.exam_id),
    title: a.exam_title as string,
    subjectId: String(a.subject_id),
    subjectName: a.subject_name as string,
    teacherName: (a.teacher_name as string) || null,
    score,
    maxScore,
    percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
    finishedAt: a.submitted_at,
  };
}

function mapTask(g: Record<string, unknown>) {
  const score = Number(g.grade);
  const maxScore = Number(g.max_grade);
  return {
    id: String(g.id),
    taskId: String(g.task_id),
    title: g.task_title as string,
    subjectId: String(g.subject_id),
    subjectName: g.subject_name as string,
    teacherName: (g.teacher_name as string) || null,
    score,
    maxScore,
    percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
    review: (g.review as string) || null,
    gradedAt: g.graded_at || null,
    submittedAt: g.submitted_at || null,
  };
}

function mapOpinion(o: Record<string, unknown>) {
  return {
    id: String(o.id),
    title: (o.title as string) || null,
    taskId: o.task_id != null ? String(o.task_id) : null,
    taskTitle: (o.task_title as string) || null,
    subjectId: o.subject_id != null ? String(o.subject_id) : null,
    subjectName: (o.subject_name as string) || null,
    teacherId: String(o.teacher_id),
    teacherName: o.teacher_name as string,
    grade: o.grade != null ? Number(o.grade) : null,
    maxGrade: o.max_grade != null ? Number(o.max_grade) : null,
    review: o.review as string,
    gradedAt: o.graded_at || null,
  };
}

export async function getChildAttendance(
  user: User | undefined,
  studentId: number,
  dateFrom?: string,
  dateTo?: string,
) {
  const child = await requireChildCtx(user, studentId);
  const range = defaultAttendanceRange();
  const from = dateFrom || range.dateFrom;
  const to = dateTo || range.dateTo;

  const [summaryTuple, records] = await Promise.all([
    repo.queryChildDashboardStats(
      child.studentId,
      child.schoolId,
      child.classroomId,
      from,
      to,
    ),
    repo.listAttendanceRecords(child.studentId, child.schoolId, from, to, 120),
  ]);
  const att = summaryTuple[0].rows[0];

  return {
    child: {
      id: String(child.studentId),
      name: child.studentName,
      gradeName: child.gradeName,
      classroomName: child.classroomName,
    },
    summary: attendancePayload(att, from, to),
    records: records.rows.map((r) => ({
      id: String(r.id),
      date: String(r.attendance_date).slice(0, 10),
      status: r.status as 'present' | 'absent' | 'late' | 'excused',
      checkInTime: r.check_in_time || null,
      checkInMethod: r.check_in_method || null,
      notes: r.notes || null,
    })),
  };
}

export async function getChildExams(user: User | undefined, studentId: number) {
  const child = await requireChildCtx(user, studentId);
  if (!child.classroomId) {
    return {
      child: { id: String(child.studentId), name: child.studentName },
      exams: [] as ReturnType<typeof mapExam>[],
    };
  }
  const result = await repo.listExamResults(child.studentId, child.classroomId);
  return {
    child: { id: String(child.studentId), name: child.studentName },
    exams: result.rows.map(mapExam),
  };
}

export async function getChildTasks(user: User | undefined, studentId: number) {
  const child = await requireChildCtx(user, studentId);
  if (!child.classroomId) {
    return {
      child: { id: String(child.studentId), name: child.studentName },
      tasks: [] as ReturnType<typeof mapTask>[],
    };
  }
  const result = await repo.listTaskGrades(child.studentId, child.classroomId);
  return {
    child: { id: String(child.studentId), name: child.studentName },
    tasks: result.rows.map(mapTask),
  };
}

export async function getChildOpinions(user: User | undefined, studentId: number) {
  const child = await requireChildCtx(user, studentId);
  const result = await repo.listTeacherOpinions(child.studentId, child.schoolId);
  return {
    child: { id: String(child.studentId), name: child.studentName },
    opinions: result.rows.map(mapOpinion),
  };
}

export async function getChildLessons(
  user: User | undefined,
  studentId: number,
  subjectId?: number,
) {
  const child = await requireChildCtx(user, studentId);
  if (!child.classroomId) {
    return {
      child: { id: String(child.studentId), name: child.studentName },
      lessons: [] as Array<Record<string, unknown>>,
    };
  }
  const result = await repo.listLessons(child.classroomId, child.schoolId, subjectId);
  return {
    child: { id: String(child.studentId), name: child.studentName },
    lessons: result.rows.map((l) => ({
      id: String(l.id),
      title: l.title,
      description: l.description || null,
      subjectId: String(l.subject_id),
      subjectName: l.subject_name,
      teacherName: l.teacher_name,
      createdAt: l.created_at,
      attachmentsCount: l.attachments_count as number,
    })),
  };
}

/** Materials list: each item named like "اللغة العربية leo". */
export async function getChildMaterials(user: User | undefined, studentId: number) {
  const child = await requireChildCtx(user, studentId);
  if (!child.classroomId) {
    return {
      child: { id: String(child.studentId), name: child.studentName },
      materials: [] as Array<Record<string, unknown>>,
    };
  }
  const result = await repo.listMaterials(child.classroomId, child.schoolId);
  return {
    child: { id: String(child.studentId), name: child.studentName },
    materials: result.rows.map((m) => {
      const subjectName = String(m.subject_name || '');
      const teacherName = String(m.teacher_name || '');
      return {
        id: String(m.subject_id),
        subjectId: String(m.subject_id),
        subjectName,
        teacherId: String(m.teacher_id),
        teacherName,
        /** Display name: "Arabic leo" / "اللغة العربية leo" */
        name: [subjectName, teacherName].filter(Boolean).join(' '),
        lessonsCount: m.lessons_count as number,
        attachmentsCount: m.attachments_count as number,
        lastPublishedAt: m.last_published_at || null,
      };
    }),
  };
}

export async function getChildMaterialDetail(
  user: User | undefined,
  studentId: number,
  subjectId: number,
) {
  const child = await requireChildCtx(user, studentId);
  if (!child.classroomId) throw new HttpError(404, 'Material not found');
  if (!Number.isFinite(subjectId) || subjectId <= 0) {
    throw new HttpError(400, 'Invalid subject id');
  }

  const data = await repo.listSubjectLessonsWithAttachments(
    child.classroomId,
    child.schoolId,
    subjectId,
  );
  if (!data.subject) throw new HttpError(404, 'Material not found');

  const subjectName = String(data.subject.subject_name || '');
  const teacherName = String(data.subject.teacher_name || '');

  return {
    child: { id: String(child.studentId), name: child.studentName },
    material: {
      id: String(data.subject.subject_id),
      subjectId: String(data.subject.subject_id),
      subjectName,
      teacherId: String(data.subject.teacher_id),
      teacherName,
      name: [subjectName, teacherName].filter(Boolean).join(' '),
    },
    lessons: data.lessons.map((l) => ({
      id: String(l.id),
      title: l.title as string,
      description: (l.description as string) || null,
      createdAt: l.created_at,
      attachments: ((l.attachments as Array<Record<string, unknown>>) || []).map((a) => ({
        id: String(a.id),
        kind: a.kind as 'video' | 'pdf',
        title: a.title as string,
        fileUrl: a.file_url as string,
        filename: (a.filename as string) || null,
      })),
    })),
  };
}

export async function getChildLessonDetail(
  user: User | undefined,
  studentId: number,
  lessonId: number,
) {
  const child = await requireChildCtx(user, studentId);
  if (!child.classroomId) throw new HttpError(404, 'Lesson not found');
  const lesson = await repo.findOwnedLesson(child.classroomId, child.schoolId, lessonId);
  if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');
  const row = lesson.rows[0];
  const attachments = await repo.listLessonAttachments(lessonId);
  return {
    lesson: {
      id: String(row.id),
      title: row.title,
      description: row.description || null,
      subjectId: String(row.subject_id),
      subjectName: row.subject_name,
      teacherName: row.teacher_name,
      createdAt: row.created_at,
    },
    attachments: attachments.rows.map((a) => ({
      id: String(a.id),
      kind: a.kind as 'video' | 'pdf',
      title: a.title,
      fileUrl: a.file_url,
      filename: a.filename || null,
    })),
  };
}
