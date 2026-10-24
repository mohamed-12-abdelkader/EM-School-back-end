import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './test/dbReset';
import { seedSchool } from './test/fixtures';
import { api, auth, loginEmail, loginStudent } from './test/http';

describe('Teacher → student exam flow', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates published exam, student starts and submits MCQ, score is graded', async () => {
    const fx = await seedSchool();
    const teacherToken = await loginEmail(fx.teacher.email);
    const studentToken = await loginStudent(fx.student.loginCode);

    const create = await api()
      .post('/api/teacher/portal/exams')
      .set(auth(teacherToken))
      .send({
        classroom_id: fx.classroomId,
        subject_id: fx.subjectId,
        title: 'Unit Quiz',
        duration_minutes: 30,
        status: 'published',
        questions: [
          {
            type: 'mcq',
            text: 'What is 2+2?',
            points: 5,
            choices: [
              { text: '3', is_correct: false },
              { text: '4', is_correct: true },
            ],
          },
        ],
      });

    expect(create.status).toBe(201);
    const examId = create.body.exam.id;
    expect(examId).toBeTruthy();

    const detail = await api()
      .get(`/api/student/portal/exams/${examId}`)
      .set(auth(studentToken));
    expect(detail.status).toBe(200);
    const questionId = Number(detail.body.questions[0].id);
    const correctChoiceId = Number(detail.body.questions[0].choiceIds[1]);

    const start = await api()
      .post(`/api/student/portal/exams/${examId}/start`)
      .set(auth(studentToken));
    expect(start.status).toBe(201);
    expect(start.body.attempt).toBeTruthy();

    const submit = await api()
      .post(`/api/student/portal/exams/${examId}/submit`)
      .set(auth(studentToken))
      .send({
        answers: [{ question_id: questionId, choice_id: correctChoiceId }],
      });
    expect(submit.status).toBe(201);
    expect(Number(submit.body.attempt.score)).toBe(5);
    expect(Number(submit.body.attempt.maxScore)).toBe(5);

    const result = await api()
      .get(`/api/student/portal/exams/${examId}/result`)
      .set(auth(studentToken));
    expect(result.status).toBe(200);
  });
});
