import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './test/dbReset';
import { seedSchool } from './test/fixtures';
import { api, auth, loginEmail, loginStudent } from './test/http';

describe('Tenant / school isolation', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('student from school B cannot access exam published in school A', async () => {
    const schoolA = await seedSchool({
      schoolCode: 'SCHOOLA',
      schoolName: 'School A',
      studentCode: '81001',
      parentCode: '82001',
      adminEmail: 'admin-a@test.local',
      teacherEmail: 'teacher-a@test.local',
    });
    const schoolB = await seedSchool({
      schoolCode: 'SCHOOLB',
      schoolName: 'School B',
      studentCode: '81002',
      parentCode: '82002',
      adminEmail: 'admin-b@test.local',
      teacherEmail: 'teacher-b@test.local',
    });

    const teacherA = await loginEmail(schoolA.teacher.email);
    const studentB = await loginStudent(schoolB.student.loginCode);

    const create = await api()
      .post('/api/teacher/portal/exams')
      .set(auth(teacherA))
      .send({
        classroom_id: schoolA.classroomId,
        subject_id: schoolA.subjectId,
        title: 'School A Only Exam',
        duration_minutes: 20,
        status: 'published',
        questions: [
          {
            type: 'mcq',
            text: 'Private question',
            points: 1,
            choices: [
              { text: 'A', is_correct: true },
              { text: 'B', is_correct: false },
            ],
          },
        ],
      });
    expect(create.status).toBe(201);
    const examId = create.body.exam.id;

    const leak = await api()
      .get(`/api/student/portal/exams/${examId}`)
      .set(auth(studentB));

    expect([403, 404]).toContain(leak.status);
  });
});
