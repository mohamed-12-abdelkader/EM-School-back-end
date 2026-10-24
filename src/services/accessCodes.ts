import crypto from 'node:crypto';
import pool from '../db/pool';

const MAX_RETRIES = 12;

/** Exactly 5 digits, zero-padded, stored as text. */
export function generateFiveDigitCode(): string {
  const n = crypto.randomInt(0, 100000);
  return String(n).padStart(5, '0');
}

/** Cryptographically strong QR token (not guessable, not PII). */
export function generateQrToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** Parent codes: unique within a school (still used with school_code). */
export async function allocateUniqueLoginCode(schoolId: number): Promise<string> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = generateFiveDigitCode();
    const exists = await pool.query(
      `SELECT id FROM users
       WHERE school_id = $1 AND login_code = $2 AND deleted_at IS NULL
         AND role IN ('student', 'parent')
       LIMIT 1`,
      [schoolId, code],
    );
    if (!exists.rowCount) return code;
  }
  throw new Error('Failed to allocate a unique login code');
}

/** Globally unique among student/parent so either role can login with code only. */
async function allocateUniquePortalLoginCode(roleLabel: string): Promise<string> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = generateFiveDigitCode();
    const exists = await pool.query(
      `SELECT id FROM users
       WHERE login_code = $1
         AND role IN ('student', 'parent')
         AND deleted_at IS NULL
       LIMIT 1`,
      [code],
    );
    if (!exists.rowCount) return code;
  }
  throw new Error(`Failed to allocate a unique ${roleLabel} login code`);
}

/** Student codes: globally unique so login needs only the student code. */
export async function allocateUniqueStudentLoginCode(): Promise<string> {
  return allocateUniquePortalLoginCode('student');
}

/** Parent codes: globally unique so login needs only the guardian code. */
export async function allocateUniqueParentLoginCode(): Promise<string> {
  return allocateUniquePortalLoginCode('parent');
}

export async function allocateUniqueQrToken(): Promise<string> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const token = generateQrToken();
    const exists = await pool.query(
      `SELECT id FROM users WHERE qr_token = $1 LIMIT 1`,
      [token],
    );
    if (!exists.rowCount) return token;
  }
  throw new Error('Failed to allocate a unique QR token');
}

export function buildQrPayload(schoolId: number, qrToken: string): string {
  // Stable machine-readable payload for attendance scanners
  return `EMS|v1|${schoolId}|${qrToken}`;
}

export function parseQrPayload(qrPayload: string): { schoolId: number; qrToken: string } | null {
  const parts = String(qrPayload || '').split('|');
  if (parts.length < 4 || parts[0] !== 'EMS') return null;
  const schoolId = Number(parts[2]);
  const qrToken = parts.slice(3).join('|');
  if (!Number.isInteger(schoolId) || schoolId <= 0 || !qrToken) return null;
  return { schoolId, qrToken };
}
