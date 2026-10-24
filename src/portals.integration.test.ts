import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './test/dbReset';
import { seedSchool } from './test/fixtures';
import { api, auth, loginEmail, loginParent, loginStudent } from './test/http';

describe('Portal dashboards', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('teacher / student / parent can load their portal dashboard', async () => {
    const fx = await seedSchool();
    const teacherToken = await loginEmail(fx.teacher.email);
    const studentToken = await loginStudent(fx.student.loginCode);
    const parentToken = await loginParent(fx.parent.loginCode);

    const teacherDash = await api()
      .get('/api/teacher/portal/dashboard')
      .set(auth(teacherToken));
    expect(teacherDash.status).toBe(200);

    const studentDash = await api()
      .get('/api/student/portal/dashboard')
      .set(auth(studentToken));
    expect(studentDash.status).toBe(200);

    const parentDash = await api()
      .get('/api/parent/portal/dashboard')
      .set(auth(parentToken));
    expect(parentDash.status).toBe(200);
  });
});
