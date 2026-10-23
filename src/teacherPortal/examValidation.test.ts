import { describe, expect, it } from 'vitest';
import { HttpError } from '../utils';
import {
  validateExamQuestions,
  validateStoredExamQuestionsForPublish,
} from './examValidation';

describe('validateExamQuestions', () => {
  it('requires exactly one correct MCQ choice', () => {
    expect(() =>
      validateExamQuestions([
        {
          type: 'mcq',
          text: 'Capital of Egypt?',
          points: 2,
          choices: [
            { text: 'Cairo', is_correct: true },
            { text: 'Alex', is_correct: true },
          ],
        },
      ]),
    ).toThrow(HttpError);

    expect(() =>
      validateExamQuestions([
        {
          type: 'mcq',
          text: 'Capital of Egypt?',
          points: 2,
          choices: [
            { text: 'Cairo', is_correct: false },
            { text: 'Alex', is_correct: false },
          ],
        },
      ]),
    ).toThrow(/exactly one correct/i);
  });

  it('accepts a valid MCQ with exactly one correct option', () => {
    expect(() =>
      validateExamQuestions([
        {
          type: 'mcq',
          text: 'Capital of Egypt?',
          points: 2,
          choices: [
            { text: 'Cairo', is_correct: true },
            { text: 'Alex', is_correct: false },
          ],
        },
      ]),
    ).not.toThrow();
  });

  it('requires at least two choices for MCQ', () => {
    expect(() =>
      validateExamQuestions([
        {
          type: 'mcq',
          text: 'Q?',
          points: 1,
          choices: [{ text: 'Only', is_correct: true }],
        },
      ]),
    ).toThrow(/at least 2 choices/i);
  });

  it('allows written questions without choices', () => {
    expect(() =>
      validateExamQuestions([
        { type: 'written', text: 'Explain photosynthesis', points: 5 },
      ]),
    ).not.toThrow();
  });

  it('blocks publishing stored exams with invalid MCQs', () => {
    expect(() =>
      validateStoredExamQuestionsForPublish([
        {
          type: 'mcq',
          text: 'Broken',
          points: 1,
          choices: [
            { text: 'A', is_correct: false },
            { text: 'B', is_correct: false },
          ],
        },
      ]),
    ).toThrow(/exactly one correct/i);
  });
});
