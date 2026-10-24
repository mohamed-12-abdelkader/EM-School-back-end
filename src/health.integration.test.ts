import { beforeAll, describe, expect, it } from 'vitest';
import { api } from './test/http';
import { resetDatabase } from './test/dbReset';

describe('GET /api/v1/health', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('returns ok from the test app', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.modules).toEqual(
      expect.arrayContaining(['auth', 'tenants', 'admissions', 'sis']),
    );
  });
});
