import { HttpError } from '../utils';

export type TaskSubmissionMode = 'questions' | 'pdf';

/** Assignment-specific: block submit after due_at (exams use duration/status instead). */
export function assertTaskDeadlineOpen(dueAt: string | Date | null | undefined, now = new Date()) {
  if (!dueAt) return;
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return;
  if (due.getTime() < now.getTime()) {
    throw new HttpError(400, 'Task deadline has passed');
  }
}

/** One submission per student unless future allow_resubmit is added. */
export function assertTaskNotAlreadySubmitted(row: {
  submitted_at?: string | Date | null;
  grade?: number | string | null;
} | null | undefined) {
  if (!row) return;
  if (row.submitted_at != null || row.grade != null) {
    throw new HttpError(400, 'Task already submitted');
  }
}

export function assertTaskMode(
  actual: string | null | undefined,
  expected: TaskSubmissionMode,
) {
  const mode = (actual || 'questions') as TaskSubmissionMode;
  if (mode !== expected) {
    throw new HttpError(
      400,
      expected === 'pdf'
        ? 'This task requires a PDF submission'
        : 'This task requires question answers, not a file upload',
    );
  }
}

const PDF_MIME = 'application/pdf';
const MAX_STUDENT_PDF_BYTES = 20 * 1024 * 1024; // 20MB student uploads

export function assertStudentPdfFile(file: {
  mimetype?: string;
  originalname?: string;
  size?: number;
} | null | undefined) {
  if (!file) throw new HttpError(400, 'PDF file is required');
  const isPdf =
    file.mimetype === PDF_MIME || /\.pdf$/i.test(file.originalname || '');
  if (!isPdf) throw new HttpError(400, 'File must be a PDF');
  if (file.size != null && file.size > MAX_STUDENT_PDF_BYTES) {
    throw new HttpError(400, 'PDF must be 20MB or smaller');
  }
}

/** Scale MCQ points onto the task max_grade (assignment rule; exams keep raw points). */
export function scaleMcqScoreToMaxGrade(
  score: number,
  mcqMax: number,
  maxGrade: number,
): number {
  if (!(maxGrade > 0)) return 0;
  if (!(mcqMax > 0)) return 0;
  return Math.round((score / mcqMax) * maxGrade * 100) / 100;
}
