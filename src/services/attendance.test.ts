import { describe, expect, it } from 'vitest';
import { buildQrPayload, parseQrPayload } from './accessCodes';
import {
  calcAttendanceRate,
  isIsoDate,
  recordsToCsv,
  todayDateString,
} from './attendance';

describe('attendance helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-10-13')).toBe(true);
    expect(isIsoDate('13-10-2026')).toBe(false);
    expect(isIsoDate('2026/10/13')).toBe(false);
  });

  it('calculates attendance rate on recorded days only', () => {
    expect(calcAttendanceRate(8, 10)).toBe(80);
    expect(calcAttendanceRate(0, 0)).toBe(0);
    expect(calcAttendanceRate(1, 3)).toBe(33.33);
  });

  it('returns today as YYYY-MM-DD', () => {
    expect(todayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('builds and parses QR payload without PII', () => {
    const payload = buildQrPayload(2, 'abcTOKEN');
    expect(payload).toBe('EMS|v1|2|abcTOKEN');
    expect(payload.includes('@')).toBe(false);
    expect(parseQrPayload(payload)).toEqual({ schoolId: 2, qrToken: 'abcTOKEN' });
    expect(parseQrPayload('bad')).toBeNull();
  });

  it('exports CSV with escaped values', () => {
    const csv = recordsToCsv([
      {
        id: 1,
        school_id: 2,
        student_id: 10,
        attendance_date: '2026-10-13',
        status: 'absent',
        check_in_time: null,
        check_in_method: 'manual',
        absence_reason: 'sick, fever',
        notes: 'note "x"',
        excuse_approved: null,
        recorded_by: 1,
        updated_by: 1,
        edit_reason: null,
        created_at: '',
        updated_at: '',
        student_name: 'Ali',
        grade_name: 'G1',
        classroom_name: '1/1',
      },
    ]);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"sick, fever"');
    expect(csv).toContain('"note ""x"""');
  });
});
