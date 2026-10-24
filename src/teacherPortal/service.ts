import type { User } from '../db/types';
import { HttpError } from '../utils';
import {
  notifyClassroomStudents,
  notifyStudent,
} from '../services/studentNotifications';
import {
  validateExamQuestions,
  validateStoredExamQuestionsForPublish,
} from './examValidation';
import * as repo from './repository';
import type { ExamQuestionInput, TeacherCtx } from './types';
import { inferAttachmentKind, resolveUploadUrl } from './upload';

export function requireTeacherSchool(user: User | undefined): TeacherCtx {
  if (!user?.school_id) {
    throw new HttpError(403, 'Teacher is not linked to a school');
  }
  return { teacherId: user.id, schoolId: user.school_id };
}

async function assertTeacherOwnsClassroomSubject(
  teacherId: number,
  schoolId: number,
  classroomId: number,
  subjectId: number,
) {
  const result = await repo.findAssignedClassroomSubject(
    teacherId,
    schoolId,
    classroomId,
    subjectId,
  );
  if (!result.rowCount) {
    throw new HttpError(403, 'This class/subject is not assigned to you');
  }
}

/** Re-validate persisted questions before allowing publish. */
async function assertExamReadyToPublish(examId: string | number) {
  const { questions, choices } = await repo.listExamQuestionsWithChoices(examId);
  if (!questions.rowCount) {
    throw new HttpError(400, 'Exam needs at least one question before publishing');
  }
  const byQ = new Map<number, typeof choices.rows>();
  for (const ch of choices.rows) {
    const list = byQ.get(ch.question_id) || [];
    list.push(ch);
    byQ.set(ch.question_id, list);
  }
  validateStoredExamQuestionsForPublish(
    questions.rows.map((q) => ({
      type: q.type,
      text: q.text,
      points: Number(q.points),
      choices: (byQ.get(q.id) || []).map((c) => ({
        text: c.text,
        is_correct: !!c.is_correct,
      })),
    })),
  );
}

export async function getDashboard(user: User | undefined) {
  const ctx = requireTeacherSchool(user);
  const [classes, lessons, exams, tasks, school] = await repo.queryDashboard(ctx);
  return {
    teacher: {
      id: user!.id,
      name: user!.name ?? null,
      email: user!.email ?? null,
      school_id: ctx.schoolId,
    },
    school: school.rows[0] ?? null,
    stats: {
      classes: classes.rows[0].c,
      lessons: lessons.rows[0].c,
      exams: exams.rows[0].c,
      tasks: tasks.rows[0].c,
    },
  };
}

export async function getClasses(user: User | undefined) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.listClasses(ctx);
  return { classes: result.rows };
}

export async function getClassDetail(
  user: User | undefined,
  classroomId: number,
  subjectId?: number,
) {
  const ctx = requireTeacherSchool(user);

  if (subjectId) {
    await assertTeacherOwnsClassroomSubject(
      ctx.teacherId,
      ctx.schoolId,
      classroomId,
      subjectId,
    );
  } else {
    const owned = await repo.findAssignedClassroom(ctx.teacherId, ctx.schoolId, classroomId);
    if (!owned.rowCount) throw new HttpError(403, 'This class is not assigned to you');
  }

  const classroom = await repo.findClassroom(classroomId, ctx.schoolId);
  if (!classroom.rowCount) throw new HttpError(404, 'Classroom not found');

  const [subjects, students, slots] = await repo.queryClassDetail(ctx, classroomId);
  return {
    classroom: classroom.rows[0],
    subjects: subjects.rows,
    students: students.rows,
    slots: slots.rows,
  };
}

export async function getLessons(user: User | undefined, classroomId?: number) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.listLessons(ctx, classroomId ?? null);
  return { lessons: result.rows };
}

export async function getLessonDetail(user: User | undefined, lessonId: string | number) {
  const ctx = requireTeacherSchool(user);
  const lesson = await repo.findLesson(ctx, lessonId);
  if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');
  const attachments = await repo.listLessonAttachments(lessonId);
  return { lesson: lesson.rows[0], attachments: attachments.rows };
}

export async function createLesson(
  user: User | undefined,
  body: {
    classroom_id: number;
    subject_id: number;
    title: string;
    description?: string | null;
  },
) {
  const ctx = requireTeacherSchool(user);
  await assertTeacherOwnsClassroomSubject(
    ctx.teacherId,
    ctx.schoolId,
    body.classroom_id,
    body.subject_id,
  );
  const result = await repo.insertLesson(ctx, body);
  const lesson = result.rows[0];
  await notifyClassroomStudents({
    schoolId: ctx.schoolId,
    classroomId: body.classroom_id,
    kind: 'lesson',
    title: 'درس جديد',
    body: lesson.title,
    href: `/lecture/${lesson.id}`,
    refType: 'lesson',
    refId: lesson.id,
  });
  return { lesson };
}

export async function updateLesson(
  user: User | undefined,
  lessonId: string | number,
  body: { title?: string; description?: string | null },
) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.updateLesson(ctx, lessonId, body);
  if (!result.rowCount) throw new HttpError(404, 'Lesson not found');
  return { lesson: result.rows[0] };
}

export async function deleteLesson(user: User | undefined, lessonId: string | number) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.softDeleteLesson(ctx, lessonId);
  if (!result.rowCount) throw new HttpError(404, 'Lesson not found');
  return { message: 'Lesson deleted' };
}

export async function addLessonAttachment(
  user: User | undefined,
  lessonId: string | number,
  body: {
    kind: 'video' | 'pdf';
    title: string;
    file_url?: string;
    filename?: string | null;
  },
  file?: Express.Multer.File,
) {
  const ctx = requireTeacherSchool(user);
  const lesson = await repo.findLessonId(ctx, lessonId);
  if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');

  const kind = inferAttachmentKind(file, body.kind, body.file_url);
  const resolved = await resolveUploadUrl(file, body.file_url);
  const result = await repo.insertLessonAttachment({
    lessonId,
    kind,
    title: body.title,
    fileUrl: resolved.url,
    filename: resolved.filename ?? body.filename ?? null,
  });
  return { attachment: result.rows[0] };
}

export async function updateLessonAttachment(
  user: User | undefined,
  lessonId: string | number,
  attachmentId: string | number,
  body: {
    kind?: 'video' | 'pdf';
    title?: string;
    file_url?: string;
    filename?: string | null;
  },
  file?: Express.Multer.File,
) {
  const ctx = requireTeacherSchool(user);
  const existing = await repo.findLessonAttachment(ctx, lessonId, attachmentId);
  if (!existing.rowCount) throw new HttpError(404, 'Attachment not found');

  const current = existing.rows[0];
  const nextKind = body.kind ?? current.kind;

  if (file) {
    const isPdf = file.mimetype === 'application/pdf';
    const isVideo = file.mimetype.startsWith('video/');
    if (nextKind === 'pdf' && !isPdf) throw new HttpError(400, 'File must be a PDF');
    if (nextKind === 'video' && !isVideo) throw new HttpError(400, 'File must be a video');
  }

  let nextUrl = current.file_url as string;
  let nextFilename = current.filename as string | null;
  if (file || body.file_url) {
    const resolved = await resolveUploadUrl(file, body.file_url);
    nextUrl = resolved.url;
    nextFilename = resolved.filename ?? body.filename ?? nextFilename;
  }

  const result = await repo.updateLessonAttachment({
    attachmentId,
    lessonId,
    kind: nextKind,
    title: body.title ?? null,
    fileUrl: nextUrl,
    filename: nextFilename,
  });
  return { attachment: result.rows[0] };
}

export async function deleteLessonAttachment(
  user: User | undefined,
  lessonId: string | number,
  attachmentId: string | number,
) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.deleteLessonAttachment(ctx, lessonId, attachmentId);
  if (!result.rowCount) throw new HttpError(404, 'Attachment not found');
  return { message: 'Attachment deleted' };
}

export async function getExams(user: User | undefined) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.listExams(ctx);
  return { exams: result.rows };
}

export async function getExamDetail(user: User | undefined, examId: string | number) {
  const ctx = requireTeacherSchool(user);
  const exam = await repo.findExam(ctx, examId);
  if (!exam.rowCount) throw new HttpError(404, 'Exam not found');

  const { questions, choices } = await repo.listExamQuestionsWithChoices(examId);
  const byQ = new Map<number, typeof choices.rows>();
  for (const ch of choices.rows) {
    const list = byQ.get(ch.question_id) || [];
    list.push(ch);
    byQ.set(ch.question_id, list);
  }

  return {
    exam: exam.rows[0],
    questions: questions.rows.map((q) => ({
      ...q,
      choices: byQ.get(q.id) || [],
    })),
  };
}

export async function createExam(
  user: User | undefined,
  body: {
    classroom_id: number;
    subject_id: number;
    title: string;
    description?: string | null;
    duration_minutes?: number | null;
    status?: string;
    questions: ExamQuestionInput[];
  },
) {
  const ctx = requireTeacherSchool(user);
  await assertTeacherOwnsClassroomSubject(
    ctx.teacherId,
    ctx.schoolId,
    body.classroom_id,
    body.subject_id,
  );
  validateExamQuestions(body.questions);

  const examId = await repo.createExam(ctx, body);
  const fresh = await repo.getExamById(examId);
  const exam = fresh.rows[0];
  if (exam.status === 'published') {
    await notifyClassroomStudents({
      schoolId: ctx.schoolId,
      classroomId: body.classroom_id,
      kind: 'exam',
      title: 'امتحان جديد',
      body: exam.title,
      href: `/exam/${exam.id}`,
      refType: 'exam',
      refId: exam.id,
    });
  }
  return { exam };
}

export async function updateExam(
  user: User | undefined,
  examId: string | number,
  body: {
    title?: string;
    description?: string | null;
    duration_minutes?: number | null;
    status?: string;
    questions?: ExamQuestionInput[];
  },
) {
  const ctx = requireTeacherSchool(user);
  const existing = await repo.findExamRow(ctx, examId);
  if (!existing.rowCount) throw new HttpError(404, 'Exam not found');
  const prevStatus = existing.rows[0].status;

  if (body.questions) validateExamQuestions(body.questions);
  // Status-only publish must re-check persisted MCQ correct options.
  if (body.status === 'published' && prevStatus !== 'published' && !body.questions) {
    await assertExamReadyToPublish(examId);
  }

  await repo.updateExam(examId, body);

  const exam = await repo.getExamById(examId);
  const row = exam.rows[0];
  if (prevStatus !== 'published' && row.status === 'published') {
    await notifyClassroomStudents({
      schoolId: ctx.schoolId,
      classroomId: row.classroom_id,
      kind: 'exam',
      title: 'امتحان جديد',
      body: row.title,
      href: `/exam/${row.id}`,
      refType: 'exam',
      refId: row.id,
    });
  }
  return { exam: row };
}

export async function deleteExam(user: User | undefined, examId: string | number) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.softDeleteExam(ctx, examId);
  if (!result.rowCount) throw new HttpError(404, 'Exam not found');
  return { message: 'Exam deleted' };
}

export async function getTasks(user: User | undefined) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.listTasks(ctx);
  return { tasks: result.rows };
}

export async function getTaskDetail(user: User | undefined, taskId: string | number) {
  const ctx = requireTeacherSchool(user);
  const task = await repo.findTask(ctx, taskId);
  if (!task.rowCount) throw new HttpError(404, 'Task not found');

  const [grades, attachments, questions, choices] = await repo.queryTaskDetail(
    taskId,
    task.rows[0].classroom_id,
    ctx.schoolId,
  );

  const byQ = new Map<number, unknown[]>();
  for (const ch of choices.rows) {
    const list = byQ.get(ch.question_id) || [];
    list.push(ch);
    byQ.set(ch.question_id, list);
  }

  return {
    task: task.rows[0],
    students: grades.rows,
    attachments: attachments.rows,
    questions: questions.rows.map((q) => ({
      ...q,
      choices: byQ.get(q.id) || [],
    })),
  };
}

export async function createTask(
  user: User | undefined,
  body: {
    classroom_id: number;
    subject_id: number;
    title: string;
    description?: string | null;
    max_grade?: number;
    due_at?: string | null;
    submission_mode?: 'questions' | 'pdf';
    questions?: ExamQuestionInput[];
  },
) {
  const ctx = requireTeacherSchool(user);
  await assertTeacherOwnsClassroomSubject(
    ctx.teacherId,
    ctx.schoolId,
    body.classroom_id,
    body.subject_id,
  );
  const mode = body.submission_mode ?? 'questions';
  if (mode === 'questions') {
    if (!body.questions?.length) {
      throw new HttpError(400, 'Questions mode requires at least one question');
    }
    validateExamQuestions(body.questions);
  } else if (body.questions?.length) {
    throw new HttpError(400, 'PDF mode cannot include in-platform questions');
  }

  const task = await repo.createTask(ctx, { ...body, submission_mode: mode });
  await notifyClassroomStudents({
    schoolId: ctx.schoolId,
    classroomId: body.classroom_id,
    kind: 'task',
    title: 'واجب جديد',
    body: task.title,
    href: `/assignment/${task.id}`,
    refType: 'task',
    refId: task.id,
  });
  return { task };
}

export async function addTaskAttachment(
  user: User | undefined,
  taskId: string | number,
  body: {
    kind?: 'pdf' | 'video';
    title: string;
    file_url?: string;
    filename?: string | null;
  },
  file?: Express.Multer.File,
) {
  const ctx = requireTeacherSchool(user);
  const task = await repo.findTaskId(ctx, taskId);
  if (!task.rowCount) throw new HttpError(404, 'Task not found');

  let kind: 'pdf' | 'video' = body.kind || 'pdf';
  if (file) {
    const isPdf =
      file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    if (!isPdf) throw new HttpError(400, 'File must be a PDF');
    kind = 'pdf';
  } else if (body.file_url && !/\.pdf(\?|$)/i.test(body.file_url)) {
    throw new HttpError(400, 'Attachment URL must be a PDF');
  }

  const resolved = await resolveUploadUrl(file, body.file_url);
  const result = await repo.insertTaskAttachment({
    taskId,
    kind,
    title: body.title,
    fileUrl: resolved.url,
    filename: resolved.filename ?? body.filename ?? null,
  });
  return { attachment: result.rows[0] };
}

export async function deleteTaskAttachment(
  user: User | undefined,
  taskId: string | number,
  attachmentId: string | number,
) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.deleteTaskAttachment(ctx, taskId, attachmentId);
  if (!result.rowCount) throw new HttpError(404, 'Attachment not found');
  return { message: 'Attachment deleted' };
}

export async function updateTask(
  user: User | undefined,
  taskId: string | number,
  body: {
    title?: string;
    description?: string | null;
    max_grade?: number;
    due_at?: string | null;
    submission_mode?: 'questions' | 'pdf';
    questions?: ExamQuestionInput[];
  },
) {
  const ctx = requireTeacherSchool(user);
  if (body.questions) validateExamQuestions(body.questions);
  if (body.submission_mode === 'questions' && body.questions && body.questions.length < 1) {
    throw new HttpError(400, 'Questions mode requires at least one question');
  }
  const task = await repo.updateTask(ctx, taskId, body);
  if (!task) throw new HttpError(404, 'Task not found');
  return { task };
}

export async function deleteTask(user: User | undefined, taskId: string | number) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.softDeleteTask(ctx, taskId);
  if (!result.rowCount) throw new HttpError(404, 'Task not found');
  return { message: 'Task deleted' };
}

export async function upsertTaskGrade(
  user: User | undefined,
  taskId: string | number,
  body: { student_id: number; grade?: number | null; review?: string | null },
) {
  const ctx = requireTeacherSchool(user);
  const task = await repo.findTaskRow(ctx, taskId);
  if (!task.rowCount) throw new HttpError(404, 'Task not found');

  const student = await repo.findStudentInClassroom(
    body.student_id,
    ctx.schoolId,
    task.rows[0].classroom_id,
  );
  if (!student.rowCount) throw new HttpError(400, 'Student not in this class');

  if (body.grade != null && Number(body.grade) > Number(task.rows[0].max_grade)) {
    throw new HttpError(400, 'Grade exceeds max_grade');
  }

  const result = await repo.upsertTaskGrade({
    taskId,
    studentId: body.student_id,
    grade: body.grade ?? null,
    review: body.review ?? null,
  });

  if (body.grade != null) {
    await notifyStudent({
      studentId: body.student_id,
      schoolId: ctx.schoolId,
      kind: 'grade',
      title: 'تم تقييم واجب',
      body: `${task.rows[0].title}: ${body.grade}/${task.rows[0].max_grade}`,
      href: `/assignment/${task.rows[0].id}`,
      refType: 'task',
      refId: task.rows[0].id,
    });
  }
  return { grade: result.rows[0] };
}

function mapOpinionRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    title: (row.title as string) || null,
    body: row.body as string,
    subject_id: row.subject_id != null ? Number(row.subject_id) : null,
    subject_name: (row.subject_name as string) || null,
    classroom_id: row.classroom_id != null ? Number(row.classroom_id) : null,
    student_id: row.student_id != null ? Number(row.student_id) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listStudentOpinions(
  user: User | undefined,
  studentId: number,
  classroomId: number,
) {
  const ctx = requireTeacherSchool(user);
  const assigned = await repo.findAssignedClassroom(ctx.teacherId, ctx.schoolId, classroomId);
  if (!assigned.rowCount) throw new HttpError(403, 'This class is not assigned to you');

  const student = await repo.findStudentInSchoolClassroom(
    studentId,
    ctx.schoolId,
    classroomId,
  );
  if (!student.rowCount) throw new HttpError(404, 'Student not found in this class');

  const result = await repo.listStudentOpinions({
    teacherId: ctx.teacherId,
    schoolId: ctx.schoolId,
    studentId,
  });

  return {
    student: {
      id: student.rows[0].id,
      name: student.rows[0].name,
      classroom_id: student.rows[0].classroom_id,
    },
    opinions: result.rows.map(mapOpinionRow),
  };
}

export async function createStudentOpinion(
  user: User | undefined,
  body: {
    student_id: number;
    classroom_id: number;
    subject_id?: number | null;
    title?: string | null;
    body: string;
  },
) {
  const ctx = requireTeacherSchool(user);
  const assigned = await repo.findAssignedClassroom(
    ctx.teacherId,
    ctx.schoolId,
    body.classroom_id,
  );
  if (!assigned.rowCount) throw new HttpError(403, 'This class is not assigned to you');

  if (body.subject_id) {
    await assertTeacherOwnsClassroomSubject(
      ctx.teacherId,
      ctx.schoolId,
      body.classroom_id,
      body.subject_id,
    );
  }

  const student = await repo.findStudentInSchoolClassroom(
    body.student_id,
    ctx.schoolId,
    body.classroom_id,
  );
  if (!student.rowCount) throw new HttpError(400, 'Student not in this class');

  const text = String(body.body || '').trim();
  if (!text) throw new HttpError(400, 'Opinion body is required');

  const result = await repo.insertStudentOpinion({
    schoolId: ctx.schoolId,
    teacherId: ctx.teacherId,
    studentId: body.student_id,
    classroomId: body.classroom_id,
    subjectId: body.subject_id ?? null,
    title: body.title?.trim() || null,
    body: text,
  });

  return { opinion: mapOpinionRow(result.rows[0]) };
}

export async function updateStudentOpinion(
  user: User | undefined,
  opinionId: number,
  body: { title?: string | null; body?: string },
) {
  const ctx = requireTeacherSchool(user);
  if (body.body !== undefined && !String(body.body).trim()) {
    throw new HttpError(400, 'Opinion body cannot be empty');
  }
  const result = await repo.updateStudentOpinion({
    id: opinionId,
    teacherId: ctx.teacherId,
    schoolId: ctx.schoolId,
    title: body.title,
    body: body.body !== undefined ? String(body.body).trim() : undefined,
  });
  if (!result.rowCount) throw new HttpError(404, 'Opinion not found');
  return { opinion: mapOpinionRow(result.rows[0]) };
}

export async function deleteStudentOpinion(user: User | undefined, opinionId: number) {
  const ctx = requireTeacherSchool(user);
  const result = await repo.softDeleteStudentOpinion(
    opinionId,
    ctx.teacherId,
    ctx.schoolId,
  );
  if (!result.rowCount) throw new HttpError(404, 'Opinion not found');
  return { message: 'Opinion deleted' };
}
