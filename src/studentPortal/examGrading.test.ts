import { describe, expect, it } from 'vitest';
import { HttpError } from '../utils';
import {
  gradeExamAnswers,
  mapDuplicateSubmitError,
  type GradeChoice,
  type GradeQuestion,
} from './examGrading';
import type { SubmitAnswer } from './types';

const questions: GradeQuestion[] = [
  { id: 1, type: 'mcq', points: 2 },
  { id: 2, type: 'mcq', points: 3 },
  { id: 3, type: 'written', points: 5 },
];

const choicesByQ = new Map<number, GradeChoice[]>([
  [
    1,
    [
      { id: 10, question_id: 1, is_correct: true },
      { id: 11, question_id: 1, is_correct: false },
    ],
  ],
  [
    2,
    [
      { id: 20, question_id: 2, is_correct: false },
      { id: 21, question_id: 2, is_correct: true },
    ],
  ],
]);

function answers(list: SubmitAnswer[]) {
  return new Map(list.map((a) => [a.question_id, a]));
}

describe('gradeExamAnswers', () => {
  it('awards full marks for correct MCQ answers', () => {
    const result = gradeExamAnswers(
      questions,
      choicesByQ,
      answers([
        { question_id: 1, choice_id: 10 },
        { question_id: 2, choice_id: 21 },
        { question_id: 3, written_answer: 'essay' },
      ]),
    );
    expect(result.score).toBe(5);
    expect(result.maxScore).toBe(5); // MCQ only
    expect(result.pendingWrittenPoints).toBe(5);
    expect(result.graded.find((g) => g.questionId === 1)?.isCorrect).toBe(true);
    expect(result.graded.find((g) => g.questionId === 1)?.pointsAwarded).toBe(2);
    expect(result.graded.find((g) => g.questionId === 3)?.isCorrect).toBeNull();
    expect(result.graded.find((g) => g.questionId === 3)?.pointsAwarded).toBe(0);
  });

  it('awards zero for incorrect MCQ answers', () => {
    const result = gradeExamAnswers(
      questions.filter((q) => q.type === 'mcq'),
      choicesByQ,
      answers([
        { question_id: 1, choice_id: 11 },
        { question_id: 2, choice_id: 20 },
      ]),
    );
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(5);
    expect(result.graded.every((g) => g.isCorrect === false)).toBe(true);
    expect(result.graded.every((g) => g.pointsAwarded === 0)).toBe(true);
  });

  it('awards zero for unanswered MCQ questions', () => {
    const result = gradeExamAnswers(
      questions.filter((q) => q.id === 1),
      choicesByQ,
      answers([]),
    );
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(2);
    expect(result.graded[0]).toMatchObject({
      choiceId: null,
      isCorrect: false,
      pointsAwarded: 0,
    });
  });

  it('rejects option IDs that do not belong to the question/exam', () => {
    expect(() =>
      gradeExamAnswers(
        questions.filter((q) => q.id === 1),
        choicesByQ,
        answers([{ question_id: 1, choice_id: 21 }]), // belongs to Q2
      ),
    ).toThrow(/option that is not part of this exam/i);
  });

  it('rejects question IDs that do not belong to the exam (tenant/exam isolation)', () => {
    expect(() =>
      gradeExamAnswers(
        questions.filter((q) => q.id === 1),
        choicesByQ,
        answers([{ question_id: 999, choice_id: 10 }]),
      ),
    ).toThrow(/question that is not part of this exam/i);
  });

  it('never uses client-provided correctness — only stored is_correct', () => {
    const result = gradeExamAnswers(
      [{ id: 1, type: 'mcq', points: 10 }],
      choicesByQ,
      answers([{ question_id: 1, choice_id: 11 }]),
    );
    expect(result.score).toBe(0);
    expect(result.graded[0].isCorrect).toBe(false);
  });
});

describe('mapDuplicateSubmitError', () => {
  it('maps Postgres unique violations to Exam already submitted', () => {
    expect(() => mapDuplicateSubmitError({ code: '23505' })).toThrow(HttpError);
    expect(() => mapDuplicateSubmitError({ code: '23505' })).toThrow(/already submitted/i);
  });

  it('rethrows unrelated errors', () => {
    expect(() => mapDuplicateSubmitError(new Error('boom'))).toThrow(/boom/);
  });
});
