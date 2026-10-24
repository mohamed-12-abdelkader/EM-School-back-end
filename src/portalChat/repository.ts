import pool from '../db/pool';

export async function assertTeacherLinkedToStudentClassroom(
  schoolId: number,
  classroomId: number,
  teacherId: number,
) {
  return pool.query(
    `SELECT 1 WHERE EXISTS (
       SELECT 1
       FROM timetable_slots ts
       JOIN timetables t ON t.id = ts.timetable_id
       WHERE t.classroom_id = $2 AND t.school_id = $1
         AND t.status = 'published' AND t.deleted_at IS NULL
         AND ts.teacher_id = $3
       UNION ALL
       SELECT 1 FROM teacher_lessons l
       WHERE l.classroom_id = $2 AND l.school_id = $1
         AND l.deleted_at IS NULL AND l.teacher_id = $3
       UNION ALL
       SELECT 1 FROM teacher_tasks tk
       WHERE tk.classroom_id = $2 AND tk.school_id = $1
         AND tk.deleted_at IS NULL AND tk.teacher_id = $3
       UNION ALL
       SELECT 1 FROM teacher_exams e
       WHERE e.classroom_id = $2 AND e.school_id = $1
         AND e.deleted_at IS NULL AND e.teacher_id = $3
     )`,
    [schoolId, classroomId, teacherId],
  );
}

export async function assertTeacherOwnsStudent(
  teacherId: number,
  schoolId: number,
  studentId: number,
) {
  return pool.query(
    `SELECT sp.classroom_id
     FROM student_profiles sp
     JOIN users su ON su.id = sp.user_id
     WHERE sp.user_id = $3 AND su.school_id = $2 AND sp.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM timetable_slots ts
         JOIN timetables t ON t.id = ts.timetable_id
         WHERE t.classroom_id = sp.classroom_id AND t.school_id = $2
           AND t.status = 'published' AND t.deleted_at IS NULL
           AND ts.teacher_id = $1
         UNION ALL
         SELECT 1 FROM teacher_lessons l
         WHERE l.classroom_id = sp.classroom_id AND l.school_id = $2
           AND l.deleted_at IS NULL AND l.teacher_id = $1
         UNION ALL
         SELECT 1 FROM teacher_tasks tk
         WHERE tk.classroom_id = sp.classroom_id AND tk.school_id = $2
           AND tk.deleted_at IS NULL AND tk.teacher_id = $1
         UNION ALL
         SELECT 1 FROM teacher_exams e
         WHERE e.classroom_id = sp.classroom_id AND e.school_id = $2
           AND e.deleted_at IS NULL AND e.teacher_id = $1
       )`,
    [teacherId, schoolId, studentId],
  );
}

export async function findThreadByParticipants(studentId: number, teacherId: number) {
  return pool.query(
    `SELECT * FROM portal_chat_threads
     WHERE student_id = $1 AND teacher_id = $2`,
    [studentId, teacherId],
  );
}

export async function findThreadById(threadId: number) {
  return pool.query(`SELECT * FROM portal_chat_threads WHERE id = $1`, [threadId]);
}

export async function createThread(schoolId: number, studentId: number, teacherId: number) {
  return pool.query(
    `INSERT INTO portal_chat_threads (school_id, student_id, teacher_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (student_id, teacher_id) DO UPDATE
       SET school_id = EXCLUDED.school_id
     RETURNING *`,
    [schoolId, studentId, teacherId],
  );
}

export async function listStudentThreads(studentId: number) {
  return pool.query(
    `SELECT
       th.*,
       u.name AS teacher_name
     FROM portal_chat_threads th
     JOIN users u ON u.id = th.teacher_id
     WHERE th.student_id = $1
     ORDER BY th.last_at DESC`,
    [studentId],
  );
}

export async function listTeacherThreads(teacherId: number) {
  return pool.query(
    `SELECT
       th.*,
       u.name AS student_name,
       sp.classroom_id,
       c.name AS classroom_name
     FROM portal_chat_threads th
     JOIN users u ON u.id = th.student_id
     LEFT JOIN student_profiles sp ON sp.user_id = th.student_id
     LEFT JOIN classrooms c ON c.id = sp.classroom_id
     WHERE th.teacher_id = $1
     ORDER BY th.last_at DESC`,
    [teacherId],
  );
}

export async function listMessages(threadId: number, limit = 200) {
  return pool.query(
    `SELECT * FROM portal_chat_messages
     WHERE thread_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [threadId, limit],
  );
}

export async function insertMessage(
  threadId: number,
  senderRole: 'student' | 'teacher',
  senderId: number,
  body: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msg = await client.query(
      `INSERT INTO portal_chat_messages (thread_id, sender_role, sender_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [threadId, senderRole, senderId, body],
    );
    if (senderRole === 'student') {
      await client.query(
        `UPDATE portal_chat_threads
         SET last_message = $2,
             last_at = NOW(),
             teacher_unread = teacher_unread + 1,
             student_unread = 0
         WHERE id = $1`,
        [threadId, body],
      );
    } else {
      await client.query(
        `UPDATE portal_chat_threads
         SET last_message = $2,
             last_at = NOW(),
             student_unread = student_unread + 1,
             teacher_unread = 0
         WHERE id = $1`,
        [threadId, body],
      );
    }
    await client.query('COMMIT');
    return msg;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markThreadRead(
  threadId: number,
  role: 'student' | 'teacher',
) {
  if (role === 'student') {
    await pool.query(
      `UPDATE portal_chat_threads SET student_unread = 0 WHERE id = $1`,
      [threadId],
    );
    await pool.query(
      `UPDATE portal_chat_messages
       SET read_at = COALESCE(read_at, NOW())
       WHERE thread_id = $1 AND sender_role = 'teacher' AND read_at IS NULL`,
      [threadId],
    );
  } else {
    await pool.query(
      `UPDATE portal_chat_threads SET teacher_unread = 0 WHERE id = $1`,
      [threadId],
    );
    await pool.query(
      `UPDATE portal_chat_messages
       SET read_at = COALESCE(read_at, NOW())
       WHERE thread_id = $1 AND sender_role = 'student' AND read_at IS NULL`,
      [threadId],
    );
  }
}

export async function findTeacherUser(teacherId: number, schoolId: number) {
  return pool.query(
    `SELECT id, name FROM users
     WHERE id = $1 AND school_id = $2 AND role = 'teacher'`,
    [teacherId, schoolId],
  );
}

export async function findStudentUser(studentId: number, schoolId: number) {
  return pool.query(
    `SELECT id, name FROM users
     WHERE id = $1 AND school_id = $2 AND role = 'student'`,
    [studentId, schoolId],
  );
}
