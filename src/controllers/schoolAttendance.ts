import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import {
  assertSchoolStudent,
  cancelAttendance,
  getAttendanceById,
  getDailySummary,
  getFrequentAbsences,
  getStudentSummary,
  listAttendance,
  listUnrecordedStudents,
  recordsToCsv,
  resolveStudentFromQr,
  todayDateString,
  upsertAttendance,
} from '../services/attendance';
import {
  BulkAttendanceSchema,
  ManualAttendanceSchema,
  QrCheckInSchema,
  UpdateAttendanceSchema,
} from './schoolAttendance.modules';

export const router = Router();

function requireSchoolId(user: Express.Request['user']): number {
  if (!user?.school_id) {
    throw new HttpError(403, 'Account is not linked to a school');
  }
  return user.school_id;
}

const staffRoles = ['school_admin', 'teacher'] as const;

/** QR check-in for today (server date). Idempotent for already-present students. */
router.post(
  '/check-in/qr',
  authMiddleware([...staffRoles]),
  validate(QrCheckInSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const student = await resolveStudentFromQr({
      schoolId,
      qrPayload: req.body.qr_payload,
      qrToken: req.body.qr_token,
    });

    const date = todayDateString();
    const result = await upsertAttendance({
      schoolId,
      studentId: student.id,
      attendanceDate: date,
      status: 'present',
      checkInMethod: 'qr',
      checkInTime: new Date(),
      actorId: req.user!.id,
      allowAlreadyPresentAsSuccess: true,
    });

    const statusCode = result.already_recorded ? 200 : result.created ? 201 : 200;
    res.status(statusCode).json({
      message: result.already_recorded
        ? 'Student already checked in today'
        : result.created
          ? 'Attendance recorded via QR'
          : 'Attendance updated via QR',
      already_recorded: result.already_recorded,
      created: result.created,
      student: {
        id: student.id,
        name: student.name,
        grade_id: student.grade_id,
        grade_name: student.grade_name,
        classroom_id: student.classroom_id,
        classroom_name: student.classroom_name,
      },
      attendance: result.record,
    });
  }),
);

/** Manual single-student attendance (create or update same day). */
router.post(
  '/manual',
  authMiddleware([...staffRoles]),
  validate(ManualAttendanceSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const date = req.body.date || todayDateString();
    await assertSchoolStudent(schoolId, req.body.student_id);

    const result = await upsertAttendance({
      schoolId,
      studentId: req.body.student_id,
      attendanceDate: date,
      status: req.body.status,
      checkInMethod: 'manual',
      checkInTime:
        req.body.status === 'present' || req.body.status === 'late' ? new Date() : null,
      absenceReason: req.body.absence_reason,
      notes: req.body.notes,
      excuseApproved: req.body.excuse_approved,
      actorId: req.user!.id,
      editReason: req.body.edit_reason,
    });

    res.status(result.created ? 201 : 200).json({
      message: result.created ? 'Attendance recorded' : 'Attendance updated',
      created: result.created,
      attendance: result.record,
    });
  }),
);

/**
 * Bulk attendance. Returns per-item results.
 * Continues on item errors (partial success).
 */
router.post(
  '/bulk',
  authMiddleware([...staffRoles]),
  validate(BulkAttendanceSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const date = req.body.date || todayDateString();
    const { items, grade_id, classroom_id } = req.body;

    const results: Array<{
      student_id: number;
      success: boolean;
      created?: boolean;
      attendance?: unknown;
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        await assertSchoolStudent(schoolId, item.student_id, {
          gradeId: grade_id,
          classroomId: classroom_id,
        });
        const saved = await upsertAttendance({
          schoolId,
          studentId: item.student_id,
          attendanceDate: date,
          status: item.status,
          checkInMethod: 'manual',
          checkInTime:
            item.status === 'present' || item.status === 'late' ? new Date() : null,
          absenceReason: item.absence_reason,
          notes: item.notes,
          excuseApproved: item.excuse_approved,
          actorId: req.user!.id,
        });
        results.push({
          student_id: item.student_id,
          success: true,
          created: saved.created,
          attendance: saved.record,
        });
      } catch (error: any) {
        results.push({
          student_id: item.student_id,
          success: false,
          error: error?.message || 'Failed to save attendance',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    res.status(successCount === items.length ? 200 : 207).json({
      message: 'Bulk attendance processed',
      date,
      total: items.length,
      success_count: successCount,
      failed_count: items.length - successCount,
      results,
    });
  }),
);

router.get(
  '/',
  authMiddleware([...staffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const q = req.query as Record<string, string | undefined>;

    const data = await listAttendance({
      schoolId,
      date: q.date,
      dateFrom: q.date_from,
      dateTo: q.date_to,
      gradeId: q.grade_id ? Number(q.grade_id) : undefined,
      classroomId: q.classroom_id ? Number(q.classroom_id) : undefined,
      studentId: q.student_id ? Number(q.student_id) : undefined,
      status: q.status as any,
      limit: q.limit ? Number(q.limit) : 50,
      skip: q.skip ? Number(q.skip) : 0,
    });

    res.json(data);
  }),
);

router.get(
  '/summary/daily',
  authMiddleware([...staffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const q = req.query as Record<string, string | undefined>;
    const date = q.date || todayDateString();

    const summary = await getDailySummary({
      schoolId,
      date,
      gradeId: q.grade_id ? Number(q.grade_id) : undefined,
      classroomId: q.classroom_id ? Number(q.classroom_id) : undefined,
    });

    res.json({ summary });
  }),
);

router.get(
  '/summary/student/:studentId',
  authMiddleware([...staffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const q = req.query as Record<string, string | undefined>;
    if (!q.date_from || !q.date_to) {
      throw new HttpError(400, 'date_from and date_to are required');
    }

    const summary = await getStudentSummary({
      schoolId,
      studentId: Number(req.params.studentId),
      dateFrom: q.date_from,
      dateTo: q.date_to,
    });

    res.json({ summary });
  }),
);

router.get(
  '/unrecorded',
  authMiddleware([...staffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const q = req.query as Record<string, string | undefined>;
    const date = q.date || todayDateString();

    const students = await listUnrecordedStudents({
      schoolId,
      date,
      gradeId: q.grade_id ? Number(q.grade_id) : undefined,
      classroomId: q.classroom_id ? Number(q.classroom_id) : undefined,
    });

    res.json({ date, students, total: students.length });
  }),
);

router.get(
  '/frequent-absences',
  authMiddleware([...staffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const q = req.query as Record<string, string | undefined>;
    if (!q.date_from || !q.date_to) {
      throw new HttpError(400, 'date_from and date_to are required');
    }

    const students = await getFrequentAbsences({
      schoolId,
      dateFrom: q.date_from,
      dateTo: q.date_to,
      minAbsences: q.min_absences ? Number(q.min_absences) : 3,
      gradeId: q.grade_id ? Number(q.grade_id) : undefined,
      classroomId: q.classroom_id ? Number(q.classroom_id) : undefined,
      limit: q.limit ? Number(q.limit) : 50,
    });

    res.json({ students, total: students.length });
  }),
);

router.get(
  '/export.csv',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const q = req.query as Record<string, string | undefined>;

    const data = await listAttendance({
      schoolId,
      date: q.date,
      dateFrom: q.date_from,
      dateTo: q.date_to,
      gradeId: q.grade_id ? Number(q.grade_id) : undefined,
      classroomId: q.classroom_id ? Number(q.classroom_id) : undefined,
      studentId: q.student_id ? Number(q.student_id) : undefined,
      status: q.status as any,
      limit: 5000,
      skip: 0,
    });

    const csv = recordsToCsv(data.records);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attendance-${q.date || q.date_from || 'export'}.csv"`,
    );
    res.send(csv);
  }),
);

router.get(
  '/:id',
  authMiddleware([...staffRoles]),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const attendance = await getAttendanceById(schoolId, Number(req.params.id));
    res.json({ attendance });
  }),
);

router.put(
  '/:id',
  authMiddleware([...staffRoles]),
  validate(UpdateAttendanceSchema),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const current = await getAttendanceById(schoolId, Number(req.params.id));

    const result = await upsertAttendance({
      schoolId,
      studentId: current.student_id,
      attendanceDate: current.attendance_date.slice(0, 10),
      status: req.body.status ?? current.status,
      checkInMethod: current.check_in_method || 'manual',
      absenceReason:
        req.body.absence_reason !== undefined
          ? req.body.absence_reason
          : current.absence_reason,
      notes: req.body.notes !== undefined ? req.body.notes : current.notes,
      excuseApproved:
        req.body.excuse_approved !== undefined
          ? req.body.excuse_approved
          : current.excuse_approved,
      actorId: req.user!.id,
      editReason: req.body.edit_reason,
    });

    res.json({
      message: 'Attendance updated',
      attendance: result.record,
    });
  }),
);

router.delete(
  '/:id',
  authMiddleware(['school_admin']),
  asyncWrapper(async (req, res) => {
    const schoolId = requireSchoolId(req.user);
    const reason =
      typeof req.body?.reason === 'string' ? req.body.reason.trim() || null : null;
    const result = await cancelAttendance({
      schoolId,
      attendanceId: Number(req.params.id),
      actorId: req.user!.id,
      reason,
    });
    res.json({ message: 'Attendance cancelled', ...result });
  }),
);
