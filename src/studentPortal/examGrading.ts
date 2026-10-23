import { HttpError } from '../utils';
import type { SubmitAnswer } from './types';

export type GradeQuestion = {
  id: number;
  type: string;
  points: number;
};

export type GradeChoice = {
  id: number;
  is_correct: boolean;
  question_id: number;
};

export type GradedAnswer = {
  questionId: number;
  type: string;
  choiceId: number | null;
  writtenAnswer: string | null;
  isCorrect: boolean | null;
  pointsAwarded: number;
};

export type GradeExamResult = {
  graded: GradedAnswer[];
  /** Points earned from auto-graded MCQ questions only. */
  score: number;
  /** Sum of MCQ question points (denominator for auto-grade percent). */
  maxScore: number;
  /** Sum of written question points pending manual grading. */
  pendingWrittenPoints: number;
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}

export function mapDuplicateSubmitError(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new HttpError(400, 'Exam already submitted');
  }
  throw err;
}

/**
 * Server-side MCQ grading. Never trusts client scores/correctness.
 * Rejects answers that reference questions/options outside this exam.
 * Written questions are stored but not auto-scored.
 */
export function gradeExamAnswers(
  questions: GradeQuestion[],
  choicesByQ: Map<number, GradeChoice[]>,
  answerMap: Map<number, SubmitAnswer>,
): GradeExamResult {
  const questionIds = new Set(questions.map((q) => q.id));

  for (const questionId of answerMap.keys()) {
    if (!questionIds.has(questionId)) {
      throw new HttpError(400, 'Answer references a question that is not part of this exam');
    }
  }

  let score = 0;
  let maxScore = 0;
  let pendingWrittenPoints = 0;
  const graded: GradedAnswer[] = [];

  for (const q of questions) {
    const pts = Number(q.points);
    const ans = answerMap.get(q.id);

    if (q.type === 'mcq') {
      maxScore += pts;
      const qChoices = choicesByQ.get(q.id) || [];
      const choiceId = ans?.choice_id ?? null;

      if (choiceId != null) {
        const belongs = qChoices.some((c) => c.id === choiceId);
        if (!belongs) {
          throw new HttpError(400, 'Answer references an option that is not part of this exam');
        }
      }

      const chosen = choiceId != null ? qChoices.find((c) => c.id === choiceId) : undefined;
      const correct = qChoices.find((c) => c.is_correct);
      const isCorrect = !!(chosen && correct && chosen.id === correct.id);
      const awarded = isCorrect ? pts : 0;
      score += awarded;
      graded.push({
        questionId: q.id,
        type: q.type,
        choiceId,
        writtenAnswer: null,
        isCorrect,
        pointsAwarded: awarded,
      });
    } else {
      pendingWrittenPoints += pts;
      graded.push({
        questionId: q.id,
        type: q.type,
        choiceId: null,
        writtenAnswer: ans?.written_answer ?? null,
        isCorrect: null,
        pointsAwarded: 0,
      });
    }
  }

  return { graded, score, maxScore, pendingWrittenPoints };
}
