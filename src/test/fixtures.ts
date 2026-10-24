import bcrypt from 'bcrypt';
import pool from '../db/pool';

export const TEST_PASSWORD = 'TestPass123!';

export type SchoolFixture = {
  schoolId: number;
  schoolCode: string;
  admin: { id: number; email: string };
  teacher: { id: number; email: string };
  student: { id: number; loginCode: string };
  parent: { id: number; loginCode: string };
  gradeId: number;
  classroomId: number;
  subjectId: number;
};

async function hashPassword() {
  return bcrypt.hash(TEST_PASSWORD, 4);
}

/**
 * Seeds one school with admin, teacher (timetable assignment), student, and parent.
 */
export async function seedSchool(opts?: {
  schoolCode?: string;
  schoolName?: string;
  studentCode?: string;
  parentCode?: string;
  adminEmail?: string;
  teacherEmail?: string;
}): Promise<SchoolFixture> {
  const schoolCode = opts?.schoolCode ?? 'TST001';
  const schoolName = opts?.schoolName ?? 'Integration Test School';
  const studentCode = opts?.studentCode ?? '91001';
  const parentCode = opts?.parentCode ?? '92001';
  const adminEmail = opts?.adminEmail ?? 'admin@test.local';
  const teacherEmail = opts?.teacherEmail ?? 'teacher@test.local';
  const password = await hashPassword();

  const school = await pool.query(
    `INSERT INTO schools (name, login_code, is_active)
     VALUES ($1, $2, TRUE)
     RETURNING id`,
    [schoolName, schoolCode],
  );
  const schoolId = school.rows[0].id as number;

  const admin = await pool.query(
    `INSERT INTO users (email, password, name, role, school_id, is_active)
     VALUES ($1, $2, 'School Admin', 'school_admin', $3, TRUE)
     RETURNING id`,
    [adminEmail, password, schoolId],
  );

  const grade = await pool.query(
    `INSERT INTO grades (name, school_id, position, is_active)
     VALUES ('Grade 1', $1, 0, TRUE)
     RETURNING id`,
    [schoolId],
  );
  const gradeId = grade.rows[0].id as number;

  const classroom = await pool.query(
    `INSERT INTO classrooms (school_id, grade_id, name, position, is_active)
     VALUES ($1, $2, '1/A', 0, TRUE)
     RETURNING id`,
    [schoolId, gradeId],
  );
  const classroomId = classroom.rows[0].id as number;

  const subject = await pool.query(
    `INSERT INTO subjects (school_id, name, position, is_active)
     VALUES ($1, 'Math', 0, TRUE)
     RETURNING id`,
    [schoolId],
  );
  const subjectId = subject.rows[0].id as number;

  await pool.query(`INSERT INTO subject_grades (subject_id, grade_id) VALUES ($1, $2)`, [
    subjectId,
    gradeId,
  ]);

  const teacher = await pool.query(
    `INSERT INTO users (email, password, name, role, school_id, is_active)
     VALUES ($1, $2, 'Test Teacher', 'teacher', $3, TRUE)
     RETURNING id`,
    [teacherEmail, password, schoolId],
  );
  const teacherId = teacher.rows[0].id as number;
  await pool.query(`INSERT INTO teacher_subjects (user_id, subject_id) VALUES ($1, $2)`, [
    teacherId,
    subjectId,
  ]);

  const student = await pool.query(
    `INSERT INTO users (name, phone, password, role, school_id, login_code, is_active)
     VALUES ('Test Student', $1, $2, 'student', $3, $4, TRUE)
     RETURNING id`,
    [`010${studentCode}`, password, schoolId, studentCode],
  );
  const studentId = student.rows[0].id as number;

  await pool.query(
    `INSERT INTO student_profiles (user_id, academic_year, grade_id, classroom_id, status)
     VALUES ($1, '2025/2026', $2, $3, 'active')`,
    [studentId, gradeId, classroomId],
  );
  await pool.query(`INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)`, [
    studentId,
    gradeId,
  ]);

  const parent = await pool.query(
    `INSERT INTO users (name, phone, password, role, school_id, login_code, is_active)
     VALUES ('Test Parent', $1, $2, 'parent', $3, $4, TRUE)
     RETURNING id`,
    [`011${parentCode}`, password, schoolId, parentCode],
  );
  const parentId = parent.rows[0].id as number;
  await pool.query(`INSERT INTO parent_profiles (user_id) VALUES ($1)`, [parentId]);
  await pool.query(
    `INSERT INTO parent_students (parent_id, student_id, relation, is_primary)
     VALUES ($1, $2, 'guardian', TRUE)`,
    [parentId, studentId],
  );

  const timetable = await pool.query(
    `INSERT INTO timetables (school_id, classroom_id, academic_year, term, status)
     VALUES ($1, $2, '2025/2026', '1', 'published')
     RETURNING id`,
    [schoolId, classroomId],
  );
  await pool.query(
    `INSERT INTO timetable_slots
       (timetable_id, day_of_week, period_number, start_time, end_time, slot_type, subject_id, teacher_id)
     VALUES ($1, 0, 1, '08:00', '08:45', 'lesson', $2, $3)`,
    [timetable.rows[0].id, subjectId, teacherId],
  );

  return {
    schoolId,
    schoolCode,
    admin: { id: admin.rows[0].id, email: adminEmail },
    teacher: { id: teacherId, email: teacherEmail },
    student: { id: studentId, loginCode: studentCode },
    parent: { id: parentId, loginCode: parentCode },
    gradeId,
    classroomId,
    subjectId,
  };
}
