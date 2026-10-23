import { HttpError } from '../utils';
import type { ExamQuestionInput } from './types';

/**
 * MCQ questions must have ≥2 non-empty choices and exactly one correct option.
 * Written questions are not auto-graded and need no choices.
 */
export function validateExamQuestions(questions: ExamQuestionInput[]) {
  if (!questions.length) {
    throw new HttpError(400, 'Exam needs at least one question');
  }

  for (const q of questions) {
    if (!q.text?.trim()) {
      throw new HttpError(400, 'Question text is required');
    }
    if (!(Number(q.points) > 0)) {
      throw new HttpError(400, 'Question points must be positive');
    }

    if (q.type === 'mcq') {
      const choices = (q.choices || []).filter((c) => c.text?.trim());
      if (choices.length < 2) {
        throw new HttpError(400, 'MCQ needs at least 2 choices');
      }
      const correctCount = choices.filter((c) => c.is_correct).length;
      if (correctCount !== 1) {
        throw new HttpError(400, 'MCQ needs exactly one correct choice');
      }
    }
  }
}

/** Shape used when re-validating questions already stored in the DB before publish. */
export type StoredExamQuestion = {
  type: string;
  text: string;
  points: number;
  choices: Array<{ text: string; is_correct: boolean }>;
};

export function validateStoredExamQuestionsForPublish(questions: StoredExamQuestion[]) {
  validateExamQuestions(
    questions.map((q) => ({
      type: q.type === 'written' ? 'written' : 'mcq',
      text: q.text,
      points: Number(q.points),
      choices: q.choices,
    })),
  );
}
