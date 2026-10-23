import { describe, expect, it } from 'vitest';
import { HttpError } from '../utils';
import {
  assertStudentPdfFile,
  assertTaskDeadlineOpen,
  assertTaskMode,
  assertTaskNotAlreadySubmitted,
  scaleMcqScoreToMaxGrade,
} from './taskRules';

describe('taskRules', () => {
  it('blocks submit after deadline', () => {
    expect(() =>
      assertTaskDeadlineOpen('2020-01-01T00:00:00.000Z', new Date('2026-01-01')),
    ).toThrow(/deadline/i);
    expect(() =>
      assertTaskDeadlineOpen('2030-01-01T00:00:00.000Z', new Date('2026-01-01')),
    ).not.toThrow();
  });

  it('blocks duplicate submissions', () => {
    expect(() =>
      assertTaskNotAlreadySubmitted({ submitted_at: new Date().toISOString() }),
    ).toThrow(/already submitted/i);
    expect(() => assertTaskNotAlreadySubmitted({ grade: 10 })).toThrow(HttpError);
    expect(() => assertTaskNotAlreadySubmitted(null)).not.toThrow();
  });

  it('enforces submission mode', () => {
    expect(() => assertTaskMode('pdf', 'questions')).toThrow(/question answers/i);
    expect(() => assertTaskMode('questions', 'pdf')).toThrow(/PDF submission/i);
    expect(() => assertTaskMode('questions', 'questions')).not.toThrow();
  });

  it('validates student PDF type and size', () => {
    expect(() => assertStudentPdfFile(null)).toThrow(/required/i);
    expect(() =>
      assertStudentPdfFile({ mimetype: 'image/png', originalname: 'x.png', size: 10 }),
    ).toThrow(/PDF/i);
    expect(() =>
      assertStudentPdfFile({
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
        size: 21 * 1024 * 1024,
      }),
    ).toThrow(/20MB/i);
    expect(() =>
      assertStudentPdfFile({
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
        size: 1000,
      }),
    ).not.toThrow();
  });

  it('scales MCQ score onto max_grade', () => {
    expect(scaleMcqScoreToMaxGrade(5, 10, 100)).toBe(50);
    expect(scaleMcqScoreToMaxGrade(10, 10, 20)).toBe(20);
    expect(scaleMcqScoreToMaxGrade(0, 10, 100)).toBe(0);
  });
});
