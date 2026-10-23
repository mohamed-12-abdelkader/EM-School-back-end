import type { User } from '../db/types';
import { HttpError } from '../utils';
import { resolveUploadUrl } from '../teacherPortal/upload';
import { gradeExamAnswers, mapDuplicateSubmitError } from './examGrading';
import { mapTaskStatus, subjectStyle } from './helpers';
import * as repo from './repository';
import {
  assertStudentPdfFile,
  assertTaskDeadlineOpen,
  assertTaskMode,
  assertTaskNotAlreadySubmitted,
  scaleMcqScoreToMaxGrade,
} from './taskRules';
import type { StudentCtx, SubmitAnswer } from './types';

export async function requireStudentCtx(user: User | undefined): Promise<StudentCtx> {
  if (!user?.school_id) throw new HttpError(403, 'Student is not linked to a school');
  const profile = await repo.findStudentProfile(user.id);
  if (!profile.rowCount || profile.rows[0].status !== 'active') {
    throw new HttpError(403, 'Student account is not active');
  }
  if (!profile.rows[0].classroom_id) {
    throw new HttpError(400, 'Student is not assigned to a classroom');
  }
  return {
    studentId: user.id,
    schoolId: user.school_id,
    classroomId: profile.rows[0].classroom_id,
    gradeId: profile.rows[0].grade_id,
    academicYear: profile.rows[0].academic_year,
    gradeName: profile.rows[0].grade_name,
    classroomName: profile.rows[0].classroom_name,
  };
}

async function assertStudentOwnsExam(ctx: StudentCtx, examId: number) {
  const exam = await repo.findOwnedExam(ctx, examId);
  if (!exam.rowCount) throw new HttpError(404, 'Exam not found');
  return exam.rows[0];
}

async function assertStudentOwnsTask(ctx: StudentCtx, taskId: number) {
  const task = await repo.findOwnedTask(ctx, taskId);
  if (!task.rowCount) throw new HttpError(404, 'Task not found');
  return task.rows[0];
}

async function assertStudentOwnsLesson(ctx: StudentCtx, lessonId: number) {
  const lesson = await repo.findOwnedLesson(ctx, lessonId);
  if (!lesson.rowCount) throw new HttpError(404, 'Lesson not found');
  return lesson.rows[0];
}

export async function getDashboard(user: User | undefined) {
  const ctx = await requireStudentCtx(user);
  const todayDow = new Date().getDay();
  const [subjects, lessons, tasks, exams, notifs, attempts, todaySlots] =
    await repo.queryDashboard(ctx, todayDow);

  const pendingTasks = tasks.rows.filter((t) => !t.submitted_at && t.grade == null).length;
  const pendingExams = exams.rows.filter((e) => !e.attempt_id).length;

  return {
    profile: {
      academic_year: ctx.academicYear,
      grade_name: ctx.gradeName,
      classroom_name: ctx.classroomName,
    },
    stats: {
      subjects_count: subjects.rows.length,
      pending_tasks: pendingTasks,
      pending_exams: pendingExams,
      unread_notifications: notifs.rows[0].c,
      avg_exam_percent: Math.round(Number(attempts.rows[0].avg_pct) || 0),
      exam_attempts: attempts.rows[0].attempts_count,
    },
    subjects: subjects.rows.map((s) => ({
      id: String(s.id),
      name: s.name,
      ...subjectStyle(s.id),
    })),
    recent_lessons: lessons.rows.map((l) => ({
      id: String(l.id),
      title: l.title,
      subjectId: String(l.subject_id),
      subjectName: l.subject_name,
      date: l.created_at,
    })),
    upcoming_tasks: tasks.rows.map((t) => ({
      id: String(t.id),
      title: t.title,
      subjectId: String(t.subject_id),
      subjectName: t.subject_name,
      teacherName: t.teacher_name,
      teacherId: String(t.teacher_id ?? ''),
      dueAt: t.due_at,
      maxScore: Number(t.max_grade),
      score: t.grade != null ? Number(t.grade) : null,
      status: mapTaskStatus(t),
    })),
    today_slots: todaySlots.rows.map((row) => {
      const style = row.subject_id
        ? subjectStyle(Number(row.subject_id))
        : { color: '#64748B', icon: 'Calendar' };
      return {
        id: String(row.id),
        day: row.day_of_week,
        periodNumber: row.period_number,
        start: row.start_time,
        end: row.end_time,
        slotType: row.slot_type,
        subjectId: row.subject_id != null ? String(row.subject_id) : '',
        subjectName: row.subject_name || null,
        teacherId: row.teacher_id != null ? String(row.teacher_id) : '',
        teacherName: row.teacher_name || null,
        room: row.notes || row.classroom_name || null,
        color: style.color,
      };
    }),
    exams: exams.rows.map((e) => ({
      id: String(e.id),
      title: e.title,
      subjectId: String(e.subject_id),
      teacherName: e.teacher_name,
      subjectName: e.subject_name,
      durationMin: e.duration_minutes,
      totalPoints: Number(e.total_points),
      attempted: !!e.attempt_id,
      score: e.score != null ? Number(e.score) : null,
      maxScore: e.attempt_max != null ? Number(e.attempt_max) : Number(e.total_points),
      date: e.created_at,
    })),
  };
}

export async function getSubjects(user: User | undefined) {
  const ctx = await requireStudentCtx(user);
  const result = await repo.listSubjects(ctx);

  return {
    subjects: result.rows.map((s) => {
      const style = subjectStyle(s.id);
      const done = Number(s.lessons_count) + Number(s.tasks_count) + Number(s.exams_count);
      const gradedHint =
        s.last_exam_score != null && s.last_exam_max
          ? Math.round((Number(s.last_exam_score) / Number(s.last_exam_max)) * 100)
          : 0;
      return {
        id: String(s.id),
        name: s.name,
        description: s.description || '',
        icon: style.icon,
        color: style.color,
        teacherId: s.teacher_id != null ? String(s.teacher_id) : '',
        teacherName: s.teacher_name || '',
        progress: Math.min(100, gradedHint || (done > 0 ? 20 : 0)),
        lecturesCount: Number(s.lessons_count),
        assignmentsCount: Number(s.tasks_count),
        examsCount: Number(s.exams_count),
        lastExamScore: s.last_exam_score != null ? Number(s.last_exam_score) : null,
        lastExamMax: s.last_exam_max != null ? Number(s.last_exam_max) : null,
      };
    }),
  };
}

export async function getSubjectDetail(user: User | undefined, subjectId: number) {
  const ctx = await requireStudentCtx(user);
  const subject = await repo.findSubject(ctx, subjectId);
  if (!subject.rowCount) throw new HttpError(404, 'Subject not found');

  const [teacher, lessons, tasks, exams] = await repo.querySubjectDetail(ctx, subjectId);
  const style = subjectStyle(subjectId);
  const teacherRow = teacher.rows[0];

  return {
    subject: {
      id: String(subject.rows[0].id),
      name: subject.rows[0].name,
      description: subject.rows[0].description || '',
      icon: style.icon,
      color: style.color,
      teacherId: teacherRow ? String(teacherRow.id) : '',
      progress: 0,
      lecturesCount: lessons.rows.length,
      assignmentsCount: tasks.rows.length,
    },
    teacher: teacherRow
      ? {
          id: String(teacherRow.id),
          name: teacherRow.name,
          avatarColor: style.color,
          subjectIds: [String(subjectId)],
        }
      : null,
    lectures: lessons.rows.map((l) => ({
      id: String(l.id),
      subjectId: String(subjectId),
      teacherId: teacherRow ? String(teacherRow.id) : String(l.teacher_id),
      title: l.title,
      durationMin: 0,
      date: l.created_at,
      type: 'recorded' as const,
      status: 'recorded' as const,
      watchProgress: 0,
      summary: l.description || '',
      completed: false,
      attachmentsCount: Number(l.attachments_count),
    })),
    assignments: tasks.rows.map((t) => ({
      id: String(t.id),
      subjectId: String(subjectId),
      teacherId: String(t.teacher_id),
      title: t.title,
      dueAt: t.due_at,
      status: mapTaskStatus(t),
      tasksCount: Number(t.questions_count),
      score: t.grade != null ? Number(t.grade) : null,
      maxScore: Number(t.max_grade),
      description: t.description || '',
      review: t.review || null,
    })),
    exams: exams.rows.map((e) => ({
      id: String(e.id),
      subjectId: String(subjectId),
      title: e.title,
      durationMin: e.duration_minutes || 0,
      questionIds: Array.from({ length: Number(e.questions_count) }, (_, i) => String(i)),
      difficulty: 'medium' as const,
      isOfficial: true,
      date: e.created_at,
      totalPoints: Number(e.total_points),
      attempted: !!e.attempt_id,
      score: e.score != null ? Number(e.score) : null,
      maxScore: e.attempt_max != null ? Number(e.attempt_max) : Number(e.total_points),
    })),
    announcements: [],
  };
}

export async function getLessons(user: User | undefined, subjectId?: number) {
  const ctx = await requireStudentCtx(user);
  const result = await repo.listLessons(ctx, subjectId ?? null);
  return {
    lessons: result.rows.map((l) => ({
      id: String(l.id),
      subjectId: String(l.subject_id),
      subjectName: l.subject_name,
      teacherId: String(l.teacher_id),
      teacherName: l.teacher_name,
      title: l.title,
      description: l.description || '',
      date: l.created_at,
      attachmentsCount: Number(l.attachments_count),
      videosCount: Number(l.videos_count),
      pdfsCount: Number(l.pdfs_count),
      type: 'recorded',
      status: 'recorded',
      durationMin: 0,
      watchProgress: 0,
      completed: false,
      summary: l.description || '',
    })),
  };
}

export async function getLessonDetail(user: User | undefined, lessonId: number) {
  const ctx = await requireStudentCtx(user);
  const lesson = await assertStudentOwnsLesson(ctx, lessonId);
  const attachments = await repo.listLessonAttachments(lesson.id);
  return {
    lesson: {
      id: String(lesson.id),
      subjectId: String(lesson.subject_id),
      subjectName: lesson.subject_name,
      teacherId: String(lesson.teacher_id),
      teacherName: lesson.teacher_name,
      title: lesson.title,
      description: lesson.description || '',
      date: lesson.created_at,
      type: 'recorded',
      status: 'recorded',
      durationMin: 0,
      watchProgress: 0,
      completed: false,
      summary: lesson.description || '',
    },
    attachments: attachments.rows.map((a) => ({
      id: String(a.id),
      kind: a.kind as 'video' | 'pdf',
      title: a.title,
      fileUrl: a.file_url,
      filename: a.filename,
    })),
  };
}

export async function getTasks(user: User | undefined, subjectId?: number) {
  const ctx = await requireStudentCtx(user);
  const result = await repo.listTasks(ctx, subjectId ?? null);
  return {
    tasks: result.rows.map((t) => ({
      id: String(t.id),
      subjectId: String(t.subject_id),
      subjectName: t.subject_name,
      teacherId: String(t.teacher_id),
      teacherName: t.teacher_name,
      title: t.title,
      dueAt: t.due_at,
      status: mapTaskStatus(t),
      tasksCount: Number(t.questions_count),
      attachmentsCount: Number(t.attachments_count),
      score: t.grade != null ? Number(t.grade) : null,
      maxScore: Number(t.max_grade),
      description: t.description || '',
      review: t.review || null,
    })),
  };
}

export async function getTaskDetail(user: User | undefined, taskId: number) {
  const ctx = await requireStudentCtx(user);
  const task = await assertStudentOwnsTask(ctx, taskId);
  const [grade, attachments, questions, choices, answers] = await repo.queryTaskDetail(
    task.id,
    ctx.studentId,
  );

  const gradeRow = grade.rows[0] || null;
  const submitted = !!gradeRow?.submitted_at || gradeRow?.grade != null;
  const byQ = new Map<number, typeof choices.rows>();
  for (const ch of choices.rows) {
    const list = byQ.get(ch.question_id) || [];
    list.push(ch);
    byQ.set(ch.question_id, list);
  }
  const ansByQ = new Map(answers.rows.map((a) => [a.question_id, a]));

  const mode = (task.submission_mode as string) || 'questions';

  return {
    task: {
      id: String(task.id),
      subjectId: String(task.subject_id),
      subjectName: task.subject_name,
      teacherId: String(task.teacher_id),
      teacherName: task.teacher_name,
      title: task.title,
      description: task.description || '',
      dueAt: task.due_at,
      maxScore: Number(task.max_grade),
      submissionMode: mode,
      status: mapTaskStatus({
        submitted_at: gradeRow?.submitted_at ?? null,
        grade: gradeRow?.grade ?? null,
        due_at: task.due_at,
      }),
      score: gradeRow?.grade != null ? Number(gradeRow.grade) : null,
      review: gradeRow?.review || null,
      submittedAt: gradeRow?.submitted_at || null,
      submissionNote: gradeRow?.submission_note || null,
      submissionFileUrl: gradeRow?.submission_file_url || null,
      submissionFilename: gradeRow?.submission_filename || null,
    },
    attachments: attachments.rows.map((a) => ({
      id: String(a.id),
      kind: a.kind,
      title: a.title,
      fileUrl: a.file_url,
      filename: a.filename,
    })),
    questions:
      mode === 'questions'
        ? questions.rows.map((q) => {
            const qChoices = byQ.get(q.id) || [];
            const ans = ansByQ.get(q.id);
            return {
              id: String(q.id),
              type: q.type as 'mcq' | 'written',
              text: q.text,
              points: Number(q.points),
              choices: qChoices.map((c) => ({
                id: String(c.id),
                text: c.text,
                ...(submitted ? { isCorrect: !!c.is_correct } : {}),
              })),
              ...(submitted
                ? {
                    modelAnswer: q.model_answer,
                    yourChoiceId: ans?.choice_id != null ? String(ans.choice_id) : null,
                    yourWritten: ans?.written_answer ?? null,
                    isCorrect: ans?.is_correct ?? null,
                    pointsAwarded: ans ? Number(ans.points_awarded) : 0,
                  }
                : {}),
            };
          })
        : [],
  };
}

export async function submitTask(
  user: User | undefined,
  taskId: number,
  body: { submission_note?: string | null; answers: SubmitAnswer[] },
) {
  const ctx = await requireStudentCtx(user);
  const task = await assertStudentOwnsTask(ctx, taskId);
  assertTaskMode(task.submission_mode, 'questions');
  assertTaskDeadlineOpen(task.due_at);

  const existing = await repo.findTaskGrade(task.id, ctx.studentId);
  assertTaskNotAlreadySubmitted(existing.rows[0]);

  const questions = await repo.listTaskQuestions(task.id);
  if (!questions.rowCount) {
    throw new HttpError(400, 'This task has no questions to answer');
  }
  const choices = await repo.listTaskChoices(task.id);
  const choicesByQ = new Map<number, typeof choices.rows>();
  for (const c of choices.rows) {
    const list = choicesByQ.get(c.question_id) || [];
    list.push(c);
    choicesByQ.set(c.question_id, list);
  }
  const answerMap = new Map(body.answers.map((a) => [a.question_id, a]));

  // Shared with exams: server-side MCQ grading; never trust client scores.
  const { graded, score, maxScore, pendingWrittenPoints } = gradeExamAnswers(
    questions.rows,
    choicesByQ,
    answerMap,
  );
  const hasWritten = pendingWrittenPoints > 0;
  const maxGrade = Number(task.max_grade);
  const gradeValue =
    !hasWritten && maxScore > 0
      ? scaleMcqScoreToMaxGrade(score, maxScore, maxGrade)
      : null;

  await repo.saveTaskSubmission({
    taskId: task.id,
    studentId: ctx.studentId,
    maxGrade,
    submissionNote: body.submission_note ?? null,
    answers: graded.map((g) => ({
      questionId: g.questionId,
      type: g.type,
      points: Number(questions.rows.find((q) => q.id === g.questionId)?.points ?? 0),
      choiceId: g.choiceId,
      writtenAnswer: g.writtenAnswer,
      isCorrect: g.isCorrect,
      pointsAwarded: g.pointsAwarded,
    })),
    gradeValue,
  });

  return {
    message: 'Task submitted',
    submission_mode: 'questions',
    auto_scored: !hasWritten,
    score: gradeValue,
    max_score: maxGrade,
    mcq_score: score,
    mcq_max: maxScore,
    pending_written_points: pendingWrittenPoints,
  };
}

/** PDF mode: student uploads completed work; teacher grades manually. */
export async function submitTaskPdf(
  user: User | undefined,
  taskId: number,
  body: { submission_note?: string | null },
  file?: Express.Multer.File,
) {
  const ctx = await requireStudentCtx(user);
  const task = await assertStudentOwnsTask(ctx, taskId);
  assertTaskMode(task.submission_mode, 'pdf');
  assertTaskDeadlineOpen(task.due_at);

  const existing = await repo.findTaskGrade(task.id, ctx.studentId);
  assertTaskNotAlreadySubmitted(existing.rows[0]);
  assertStudentPdfFile(file);

  const resolved = await resolveUploadUrl(file);
  await repo.saveTaskSubmission({
    taskId: task.id,
    studentId: ctx.studentId,
    maxGrade: Number(task.max_grade),
    submissionNote: body.submission_note ?? null,
    answers: [],
    gradeValue: null,
    submissionFileUrl: resolved.url,
    submissionFilename: resolved.filename ?? file!.originalname,
  });

  return {
    message: 'Task PDF submitted',
    submission_mode: 'pdf',
    auto_scored: false,
    score: null,
    max_score: Number(task.max_grade),
    submission_file_url: resolved.url,
    submission_filename: resolved.filename ?? file!.originalname,
  };
}

export async function getExams(user: User | undefined, subjectId?: number) {
  const ctx = await requireStudentCtx(user);
  const result = await repo.listExams(ctx, subjectId ?? null);
  return {
    exams: result.rows.map((e) => ({
      id: String(e.id),
      subjectId: String(e.subject_id),
      subjectName: e.subject_name,
      teacherName: e.teacher_name,
      title: e.title,
      description: e.description || '',
      durationMin: e.duration_minutes || 30,
      totalPoints: Number(e.total_points),
      questionsCount: Number(e.questions_count),
      status: e.status,
      date: e.created_at,
      attempted: !!e.attempt_id,
      attemptId: e.attempt_id != null ? String(e.attempt_id) : null,
      score: e.score != null ? Number(e.score) : null,
      maxScore: e.attempt_max != null ? Number(e.attempt_max) : Number(e.total_points),
      questionIds: Array.from({ length: Number(e.questions_count) }, (_, i) => String(i)),
      difficulty: 'medium' as const,
      isOfficial: true,
    })),
  };
}

export async function getExamDetail(user: User | undefined, examId: number) {
  const ctx = await requireStudentCtx(user);
  const exam = await assertStudentOwnsExam(ctx, examId);
  const [questions, choices, attempt] = await repo.queryExamDetail(exam.id, ctx.studentId);

  const submitted = !!attempt.rowCount;
  const byQ = new Map<number, typeof choices.rows>();
  for (const ch of choices.rows) {
    const list = byQ.get(ch.question_id) || [];
    list.push(ch);
    byQ.set(ch.question_id, list);
  }

  let answerRows: {
    question_id: number;
    choice_id: number | null;
    written_answer: string | null;
    is_correct: boolean | null;
    points_awarded: number;
  }[] = [];
  if (submitted) {
    const ans = await repo.listExamAnswers(attempt.rows[0].id);
    answerRows = ans.rows;
  }
  const ansByQ = new Map(answerRows.map((a) => [a.question_id, a]));

  return {
    exam: {
      id: String(exam.id),
      subjectId: String(exam.subject_id),
      subjectName: exam.subject_name,
      teacherName: exam.teacher_name,
      title: exam.title,
      description: exam.description || '',
      durationMin: exam.duration_minutes || 0,
      totalPoints: Number(exam.total_points),
      status: exam.status,
      date: exam.created_at,
      attempted: submitted,
      attemptId: submitted ? String(attempt.rows[0].id) : null,
      score: submitted ? Number(attempt.rows[0].score) : null,
      maxScore: submitted ? Number(attempt.rows[0].max_score) : Number(exam.total_points),
      questionIds: questions.rows.map((q) => String(q.id)),
      difficulty: 'medium' as const,
      isOfficial: true,
    },
    questions: questions.rows.map((q) => {
      const qChoices = byQ.get(q.id) || [];
      const ans = ansByQ.get(q.id);
      const correctIndex = qChoices.findIndex((c) => c.is_correct);
      return {
        id: String(q.id),
        type: q.type as 'mcq' | 'written',
        text: q.text,
        points: Number(q.points),
        choices: qChoices.map((c) => c.text),
        choiceIds: qChoices.map((c) => String(c.id)),
        correctIndex: submitted ? (correctIndex >= 0 ? correctIndex : 0) : -1,
        difficulty: 'medium' as const,
        explanation: submitted ? q.model_answer || undefined : undefined,
        ...(submitted
          ? {
              modelAnswer: q.model_answer,
              yourChoiceId: ans?.choice_id != null ? String(ans.choice_id) : null,
              yourWritten: ans?.written_answer ?? null,
              isCorrect: ans?.is_correct ?? null,
              pointsAwarded: ans ? Number(ans.points_awarded) : 0,
            }
          : {}),
      };
    }),
  };
}

export async function submitExam(
  user: User | undefined,
  examId: number,
  body: { answers: SubmitAnswer[] },
) {
  const ctx = await requireStudentCtx(user);
  const exam = await assertStudentOwnsExam(ctx, examId);
  if (exam.status !== 'published') {
    throw new HttpError(
      400,
      exam.status === 'closed' ? 'Exam is closed' : 'Exam is not open for submission',
    );
  }

  const existing = await repo.findExamAttempt(exam.id, ctx.studentId);
  if (existing.rowCount) throw new HttpError(400, 'Exam already submitted');

  const questions = await repo.listExamQuestions(exam.id);
  const choices = await repo.listExamChoices(exam.id);
  const choicesByQ = new Map<number, typeof choices.rows>();
  for (const c of choices.rows) {
    const list = choicesByQ.get(c.question_id) || [];
    list.push(c);
    choicesByQ.set(c.question_id, list);
  }
  const answerMap = new Map(body.answers.map((a) => [a.question_id, a]));

  const { graded, score, maxScore, pendingWrittenPoints } = gradeExamAnswers(
    questions.rows,
    choicesByQ,
    answerMap,
  );

  let attemptId: number;
  try {
    attemptId = await repo.saveExamSubmission({
      examId: exam.id,
      studentId: ctx.studentId,
      answers: graded,
      score,
      maxScore,
    });
  } catch (err) {
    mapDuplicateSubmitError(err);
  }

  const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
  return {
    attempt: {
      id: String(attemptId),
      examId: String(exam.id),
      score,
      maxScore,
      percent,
      pendingWrittenPoints,
      finishedAt: new Date().toISOString(),
    },
  };
}

export async function getExamResult(user: User | undefined, examId: number) {
  const ctx = await requireStudentCtx(user);
  const exam = await assertStudentOwnsExam(ctx, examId);
  const attempt = await repo.findFullExamAttempt(exam.id, ctx.studentId);
  if (!attempt.rowCount) throw new HttpError(404, 'No attempt found');

  const [questions, choices, answers] = await repo.queryExamResultParts(
    exam.id,
    attempt.rows[0].id,
  );

  const byQ = new Map<number, typeof choices.rows>();
  for (const ch of choices.rows) {
    const list = byQ.get(ch.question_id) || [];
    list.push(ch);
    byQ.set(ch.question_id, list);
  }
  const ansByQ = new Map(answers.rows.map((a) => [a.question_id, a]));
  const score = Number(attempt.rows[0].score);
  const maxScore = Number(attempt.rows[0].max_score);

  const answersRecord: Record<string, number> = {};
  for (const a of answers.rows) {
    if (a.choice_id != null) {
      const qChoices = byQ.get(a.question_id) || [];
      const idx = qChoices.findIndex((c) => c.id === a.choice_id);
      if (idx >= 0) answersRecord[String(a.question_id)] = idx;
    }
  }

  return {
    attempt: {
      id: String(attempt.rows[0].id),
      examId: String(exam.id),
      score,
      maxScore,
      percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
      finishedAt: attempt.rows[0].submitted_at,
      answers: answersRecord,
    },
    exam: {
      id: String(exam.id),
      title: exam.title,
      subjectName: exam.subject_name,
    },
    questions: questions.rows.map((q) => {
      const qChoices = byQ.get(q.id) || [];
      const ans = ansByQ.get(q.id);
      const correctIndex = qChoices.findIndex((c) => c.is_correct);
      return {
        id: String(q.id),
        type: q.type,
        text: q.text,
        points: Number(q.points),
        choices: qChoices.map((c) => c.text),
        choiceIds: qChoices.map((c) => String(c.id)),
        correctIndex: correctIndex >= 0 ? correctIndex : 0,
        explanation: q.model_answer || undefined,
        difficulty: 'medium' as const,
        yourChoiceId: ans?.choice_id != null ? String(ans.choice_id) : null,
        yourWritten: ans?.written_answer ?? null,
        isCorrect: ans?.is_correct ?? null,
        pointsAwarded: ans ? Number(ans.points_awarded) : 0,
      };
    }),
  };
}

export async function getResults(user: User | undefined) {
  const ctx = await requireStudentCtx(user);
  const [examAttempts, taskGrades] = await repo.queryResults(ctx);
  return {
    examAttempts: examAttempts.rows.map((a) => ({
      id: String(a.id),
      examId: String(a.exam_id),
      examTitle: a.exam_title,
      subjectId: String(a.subject_id),
      subjectName: a.subject_name,
      score: Number(a.score),
      maxScore: Number(a.max_score),
      percent: a.max_score ? Math.round((Number(a.score) / Number(a.max_score)) * 100) : 0,
      finishedAt: a.submitted_at,
    })),
    taskGrades: taskGrades.rows.map((g) => ({
      id: String(g.id),
      taskId: String(g.task_id),
      taskTitle: g.task_title,
      subjectId: String(g.subject_id),
      subjectName: g.subject_name,
      score: Number(g.grade),
      maxScore: Number(g.max_grade),
      review: g.review,
      gradedAt: g.graded_at,
    })),
  };
}

export async function getNotifications(user: User | undefined) {
  const ctx = await requireStudentCtx(user);
  const result = await repo.listNotifications(ctx.studentId);
  return {
    notifications: result.rows.map((n) => ({
      id: String(n.id),
      kind: n.kind,
      title: n.title,
      body: n.body,
      at: n.created_at,
      read: !!n.read_at,
      href: n.href,
      refType: n.ref_type,
      refId: n.ref_id != null ? String(n.ref_id) : null,
    })),
  };
}

export async function getTimetable(user: User | undefined, day?: number) {
  const ctx = await requireStudentCtx(user);
  const dayFilter = day != null && !Number.isNaN(day) ? day : null;
  const result = await repo.listTimetableSlots(ctx, dayFilter);

  const slots = result.rows.map((row) => {
    const style = row.subject_id
      ? subjectStyle(Number(row.subject_id))
      : { color: '#64748B', icon: 'Calendar' };
    return {
      id: String(row.id),
      day: row.day_of_week,
      periodNumber: row.period_number,
      start: row.start_time,
      end: row.end_time,
      slotType: row.slot_type,
      subjectId: row.subject_id != null ? String(row.subject_id) : '',
      subjectName: row.subject_name || null,
      teacherId: row.teacher_id != null ? String(row.teacher_id) : '',
      teacherName: row.teacher_name || null,
      notes: row.notes || null,
      room: row.notes || row.classroom_name || null,
      color: style.color,
    };
  });

  return {
    classroomId: String(ctx.classroomId),
    classroomName: ctx.classroomName,
    gradeName: ctx.gradeName,
    academicYear: ctx.academicYear,
    slots,
  };
}

export async function markNotificationRead(user: User | undefined, notificationId: string) {
  const ctx = await requireStudentCtx(user);
  await repo.markNotificationRead(notificationId, ctx.studentId);
  return { message: 'ok' };
}

export async function markAllNotificationsRead(user: User | undefined) {
  const ctx = await requireStudentCtx(user);
  await repo.markAllNotificationsRead(ctx.studentId);
  return { message: 'ok' };
}
