import request from 'supertest';
import { app } from '../app';
import { TEST_PASSWORD } from './fixtures';

export function api() {
  return request(app);
}

export async function loginEmail(email: string, password = TEST_PASSWORD) {
  const res = await api().post('/api/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`loginEmail failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export async function loginStudent(loginCode: string) {
  const res = await api().post('/api/login/student').send({ login_code: loginCode });
  if (res.status !== 200) {
    throw new Error(`loginStudent failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export async function loginParent(loginCode: string) {
  const res = await api().post('/api/login/parent').send({ login_code: loginCode });
  if (res.status !== 200) {
    throw new Error(`loginParent failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
