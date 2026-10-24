import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from './test/dbReset';
import { seedSchool } from './test/fixtures';
import { api, auth, loginEmail, loginParent } from './test/http';

describe('Attendance integration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('school admin marks attendance and parent dashboard still loads', async () => {
    const fx = await seedSchool();
    const adminToken = await loginEmail(fx.admin.email);
    const parentToken = await loginParent(fx.parent.loginCode);

    const mark = await api()
      .post('/api/school/attendance/manual')
      .set(auth(adminToken))
      .send({
        student_id: fx.student.id,
        status: 'present',
        date: '2026-10-24',
      });

    expect([200, 201]).toContain(mark.status);

    const parentDash = await api()
      .get('/api/parent/portal/dashboard')
      .set(auth(parentToken));
    expect(parentDash.status).toBe(200);
  });
});
