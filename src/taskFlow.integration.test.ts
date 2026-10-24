import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './test/dbReset';
import { seedSchool } from './test/fixtures';
import { api, auth, loginEmail, loginStudent } from './test/http';

describe('Teacher → student task flow', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates questions task and student submits written answers', async () => {
    const fx = await seedSchool();
    const teacherToken = await loginEmail(fx.teacher.email);
    const studentToken = await loginStudent(fx.student.loginCode);

    const create = await api()
      .post('/api/teacher/portal/tasks')
      .set(auth(teacherToken))
      .send({
        classroom_id: fx.classroomId,
        subject_id: fx.subjectId,
        title: 'Homework 1',
        max_grade: 10,
        submission_mode: 'questions',
        questions: [
          {
            type: 'written',
            text: 'Explain photosynthesis briefly',
            points: 10,
            model_answer: 'Plants convert light to energy',
          },
        ],
      });

    expect(create.status).toBe(201);
    const taskId = create.body.task.id;
    expect(taskId).toBeTruthy();

    const detail = await api()
      .get(`/api/student/portal/tasks/${taskId}`)
      .set(auth(studentToken));
    expect(detail.status).toBe(200);
    const questionId = Number(detail.body.questions[0].id);

    const submit = await api()
      .post(`/api/student/portal/tasks/${taskId}/submit`)
      .set(auth(studentToken))
      .send({
        answers: [
          {
            question_id: questionId,
            written_answer: 'Light energy becomes chemical energy in plants.',
          },
        ],
      });

    expect(submit.status).toBe(201);
  });
});
