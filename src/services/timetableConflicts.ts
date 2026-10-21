import pool from '../db/pool';

export type SlotInput = {
  id?: number;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
  slot_type: 'lesson' | 'break' | 'activity' | 'reserve';
  subject_id?: number | null;
  teacher_id?: number | null;
  notes?: string | null;
};

export type TimetableConflict = {
  code:
    | 'DUPLICATE_CELL'
    | 'OVERLAPPING_TIMES'
    | 'TEACHER_BUSY'
    | 'SUBJECT_NOT_IN_GRADE'
    | 'TEACHER_SUBJECT_MISMATCH'
    | 'INVALID_LESSON_FIELDS'
    | 'INVALID_TIME_RANGE';
  message: string;
  day_of_week?: number;
  period_number?: number;
  teacher_id?: number | null;
  subject_id?: number | null;
  conflicting_timetable_id?: number;
  conflicting_classroom_id?: number;
  conflicting_slot_id?: number;
};

function timeToMinutes(t: string): number {
  const parts = String(t).slice(0, 8).split(':').map(Number);
  return parts[0] * 60 + parts[1] + (parts[2] || 0) / 60;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const s1 = timeToMinutes(aStart);
  const e1 = timeToMinutes(aEnd);
  const s2 = timeToMinutes(bStart);
  const e2 = timeToMinutes(bEnd);
  return s1 < e2 && s2 < e1;
}

export async function validateTimetableSlots(params: {
  schoolId: number;
  classroomId: number;
  gradeId: number;
  timetableId?: number;
  academicYear: string;
  term: string;
  slots: SlotInput[];
  allowTeacherConflicts?: boolean;
}): Promise<TimetableConflict[]> {
  const {
    schoolId,
    classroomId,
    gradeId,
    timetableId,
    academicYear,
    term,
    slots,
    allowTeacherConflicts = false,
  } = params;

  const conflicts: TimetableConflict[] = [];

  // Duplicate cells inside payload
  const cellKeys = new Map<string, number>();
  for (const slot of slots) {
    const key = `${slot.day_of_week}:${slot.period_number}`;
    if (cellKeys.has(key)) {
      conflicts.push({
        code: 'DUPLICATE_CELL',
        message: `Duplicate slot for day ${slot.day_of_week} period ${slot.period_number}`,
        day_of_week: slot.day_of_week,
        period_number: slot.period_number,
      });
    } else {
      cellKeys.set(key, 1);
    }

    if (timeToMinutes(slot.end_time) <= timeToMinutes(slot.start_time)) {
      conflicts.push({
        code: 'INVALID_TIME_RANGE',
        message: `Invalid time range for day ${slot.day_of_week} period ${slot.period_number}`,
        day_of_week: slot.day_of_week,
        period_number: slot.period_number,
      });
    }

    if (slot.slot_type === 'lesson' && (!slot.subject_id || !slot.teacher_id)) {
      conflicts.push({
        code: 'INVALID_LESSON_FIELDS',
        message: `Lesson slots require subject_id and teacher_id (day ${slot.day_of_week}, period ${slot.period_number})`,
        day_of_week: slot.day_of_week,
        period_number: slot.period_number,
        subject_id: slot.subject_id ?? null,
        teacher_id: slot.teacher_id ?? null,
      });
    }
  }

  // Overlapping times same day inside same timetable payload
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.day_of_week !== b.day_of_week) continue;
      if (overlaps(a.start_time, a.end_time, b.start_time, b.end_time)) {
        conflicts.push({
          code: 'OVERLAPPING_TIMES',
          message: `Overlapping times on day ${a.day_of_week} between periods ${a.period_number} and ${b.period_number}`,
          day_of_week: a.day_of_week,
          period_number: a.period_number,
        });
      }
    }
  }

  // Subject must belong to classroom grade
  const lessonSubjectIds = [
    ...new Set(
      slots
        .filter((s) => s.slot_type === 'lesson' && s.subject_id)
        .map((s) => Number(s.subject_id)),
    ),
  ];

  if (lessonSubjectIds.length) {
    const subjectRows = await pool.query(
      `SELECT s.id
       FROM subjects s
       JOIN subject_grades sg ON sg.subject_id = s.id
       WHERE s.school_id = $1
         AND s.deleted_at IS NULL
         AND s.is_active = TRUE
         AND sg.grade_id = $2
         AND s.id = ANY($3::int[])`,
      [schoolId, gradeId, lessonSubjectIds],
    );
    const allowed = new Set(subjectRows.rows.map((r) => r.id));
    for (const slot of slots) {
      if (slot.slot_type !== 'lesson' || !slot.subject_id) continue;
      if (!allowed.has(Number(slot.subject_id))) {
        conflicts.push({
          code: 'SUBJECT_NOT_IN_GRADE',
          message: `Subject ${slot.subject_id} is not assigned to this classroom's grade`,
          day_of_week: slot.day_of_week,
          period_number: slot.period_number,
          subject_id: slot.subject_id,
        });
      }
    }
  }

  // Teacher must teach the subject and belong to school
  const lessonPairs = slots.filter(
    (s) => s.slot_type === 'lesson' && s.subject_id && s.teacher_id,
  );
  if (lessonPairs.length) {
    const teacherIds = [...new Set(lessonPairs.map((s) => Number(s.teacher_id)))];
    const teacherSubjects = await pool.query(
      `SELECT u.id AS teacher_id, ts.subject_id
       FROM users u
       JOIN teacher_subjects ts ON ts.user_id = u.id
       WHERE u.school_id = $1
         AND u.role = 'teacher'
         AND u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND u.id = ANY($2::int[])`,
      [schoolId, teacherIds],
    );
    const map = new Map<number, number>();
    for (const row of teacherSubjects.rows) {
      map.set(row.teacher_id, row.subject_id);
    }

    for (const slot of lessonPairs) {
      const expected = map.get(Number(slot.teacher_id));
      if (!expected) {
        conflicts.push({
          code: 'TEACHER_SUBJECT_MISMATCH',
          message: `Teacher ${slot.teacher_id} is not an active teacher in this school`,
          day_of_week: slot.day_of_week,
          period_number: slot.period_number,
          teacher_id: slot.teacher_id,
          subject_id: slot.subject_id,
        });
      } else if (expected !== Number(slot.subject_id)) {
        conflicts.push({
          code: 'TEACHER_SUBJECT_MISMATCH',
          message: `Teacher ${slot.teacher_id} is not assigned to subject ${slot.subject_id}`,
          day_of_week: slot.day_of_week,
          period_number: slot.period_number,
          teacher_id: slot.teacher_id,
          subject_id: slot.subject_id,
        });
      }
    }
  }

  // Teacher busy across other published/draft timetables in same year/term
  if (!allowTeacherConflicts) {
    const teacherLessonSlots = slots.filter(
      (s) => s.slot_type === 'lesson' && s.teacher_id,
    );

    if (teacherLessonSlots.length) {
      const otherSlots = await pool.query(
        `SELECT
           ts.id AS slot_id,
           ts.day_of_week,
           ts.period_number,
           ts.start_time::text AS start_time,
           ts.end_time::text AS end_time,
           ts.teacher_id,
           t.id AS timetable_id,
           t.classroom_id
         FROM timetable_slots ts
         JOIN timetables t ON t.id = ts.timetable_id
         WHERE t.school_id = $1
           AND t.deleted_at IS NULL
           AND t.academic_year = $2
           AND t.term = $3
           AND t.classroom_id <> $4
           AND ($5::int IS NULL OR t.id <> $5)
           AND ts.slot_type = 'lesson'
           AND ts.teacher_id IS NOT NULL`,
        [schoolId, academicYear, term, classroomId, timetableId ?? null],
      );

      for (const slot of teacherLessonSlots) {
        for (const other of otherSlots.rows) {
          if (Number(other.teacher_id) !== Number(slot.teacher_id)) continue;
          if (Number(other.day_of_week) !== Number(slot.day_of_week)) continue;
          if (
            overlaps(
              slot.start_time,
              slot.end_time,
              other.start_time,
              other.end_time,
            )
          ) {
            conflicts.push({
              code: 'TEACHER_BUSY',
              message: `Teacher ${slot.teacher_id} is already assigned at this time in another classroom`,
              day_of_week: slot.day_of_week,
              period_number: slot.period_number,
              teacher_id: slot.teacher_id,
              conflicting_timetable_id: other.timetable_id,
              conflicting_classroom_id: other.classroom_id,
              conflicting_slot_id: other.slot_id,
            });
          }
        }
      }

      // Same teacher overlapping inside current payload across different periods same day
      for (let i = 0; i < teacherLessonSlots.length; i++) {
        for (let j = i + 1; j < teacherLessonSlots.length; j++) {
          const a = teacherLessonSlots[i];
          const b = teacherLessonSlots[j];
          if (Number(a.teacher_id) !== Number(b.teacher_id)) continue;
          if (a.day_of_week !== b.day_of_week) continue;
          if (overlaps(a.start_time, a.end_time, b.start_time, b.end_time)) {
            conflicts.push({
              code: 'TEACHER_BUSY',
              message: `Teacher ${a.teacher_id} has overlapping lessons in this timetable`,
              day_of_week: a.day_of_week,
              period_number: a.period_number,
              teacher_id: a.teacher_id,
            });
          }
        }
      }
    }
  }

  return conflicts;
}
