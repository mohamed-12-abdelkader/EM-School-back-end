import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './test/dbReset';
import { seedSchool, TEST_PASSWORD } from './test/fixtures';
import { api, auth, loginEmail, loginParent, loginStudent } from './test/http';

describe('Auth integration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('logs in school_admin and teacher with email/password', async () => {
    const fx = await seedSchool();

    const adminRes = await api()
      .post('/api/login')
      .send({ email: fx.admin.email, password: TEST_PASSWORD });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.token).toEqual(expect.any(String));
    expect(adminRes.body.user.role).toBe('school_admin');

    const teacherRes = await api()
      .post('/api/login')
      .send({ email: fx.teacher.email, password: TEST_PASSWORD });
    expect(teacherRes.status).toBe(200);
    expect(teacherRes.body.user.role).toBe('teacher');
  });

  it('rejects invalid password', async () => {
    const fx = await seedSchool();
    const res = await api()
      .post('/api/login')
      .send({ email: fx.admin.email, password: 'wrong-password' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid/i);
  });

  it('logs in student and parent by login_code', async () => {
    const fx = await seedSchool();

    const studentRes = await api()
      .post('/api/login/student')
      .send({ login_code: fx.student.loginCode });
    expect(studentRes.status).toBe(200);
    expect(studentRes.body.user.role).toBe('student');
    expect(studentRes.body.token).toEqual(expect.any(String));

    const parentRes = await api()
      .post('/api/login/parent')
      .send({ login_code: fx.parent.loginCode });
    expect(parentRes.status).toBe(200);
    expect(parentRes.body.user.role).toBe('parent');
  });

  it('returns 401 without token and 403 for wrong role', async () => {
    const fx = await seedSchool();
    const studentToken = await loginStudent(fx.student.loginCode);

    const noAuth = await api().get('/api/teacher/portal/dashboard');
    expect(noAuth.status).toBe(401);

    const forbidden = await api()
      .get('/api/teacher/portal/dashboard')
      .set(auth(studentToken));
    expect(forbidden.status).toBe(403);
  });

  it('helpers loginEmail / loginStudent / loginParent work', async () => {
    const fx = await seedSchool();
    await expect(loginEmail(fx.teacher.email)).resolves.toEqual(expect.any(String));
    await expect(loginStudent(fx.student.loginCode)).resolves.toEqual(expect.any(String));
    await expect(loginParent(fx.parent.loginCode)).resolves.toEqual(expect.any(String));
  });
});
