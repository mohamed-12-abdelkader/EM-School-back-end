import type { User } from '../db/types';
import { HttpError } from '../utils';
import { notifyStudent } from '../services/studentNotifications';
import { requireStudentCtx } from '../studentPortal/service';
import { requireTeacherSchool } from '../teacherPortal/service';
import * as repo from './repository';

function mapThreadStudent(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    teacherId: String(row.teacher_id),
    teacherName: (row.teacher_name as string) || null,
    studentId: String(row.student_id),
    lastMessage: (row.last_message as string) || 'لا رسائل بعد — ابدأ المحادثة',
    lastAt: row.last_at,
    unread: Number(row.student_unread) || 0,
  };
}

function mapThreadTeacher(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    teacherId: String(row.teacher_id),
    studentId: String(row.student_id),
    studentName: (row.student_name as string) || 'طالب',
    classroomName: (row.classroom_name as string) || null,
    lastMessage: (row.last_message as string) || 'لا رسائل بعد',
    lastAt: row.last_at,
    unread: Number(row.teacher_unread) || 0,
  };
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    from: row.sender_role as 'student' | 'teacher',
    text: row.body as string,
    at: row.created_at,
    read: !!row.read_at,
  };
}

export async function listStudentChats(user: User | undefined) {
  const ctx = await requireStudentCtx(user);
  const threads = await repo.listStudentThreads(ctx.studentId);
  return { threads: threads.rows.map(mapThreadStudent) };
}

export async function ensureStudentChatWithTeacher(
  user: User | undefined,
  teacherId: number,
) {
  const ctx = await requireStudentCtx(user);
  const teacher = await repo.findTeacherUser(teacherId, ctx.schoolId);
  if (!teacher.rowCount) throw new HttpError(404, 'المدرس غير موجود');

  const linked = await repo.assertTeacherLinkedToStudentClassroom(
    ctx.schoolId,
    ctx.classroomId,
    teacherId,
  );
  if (!linked.rowCount) {
    throw new HttpError(403, 'هذا المدرس غير مرتبط بفصلك');
  }

  const created = await repo.createThread(ctx.schoolId, ctx.studentId, teacherId);
  const row = created.rows[0];
  return {
    thread: {
      id: String(row.id),
      teacherId: String(row.teacher_id),
      teacherName: teacher.rows[0].name,
      studentId: String(row.student_id),
      lastMessage: row.last_message || 'لا رسائل بعد — ابدأ المحادثة',
      lastAt: row.last_at,
      unread: Number(row.student_unread) || 0,
    },
  };
}

export async function listTeacherChats(user: User | undefined) {
  const ctx = requireTeacherSchool(user);
  const threads = await repo.listTeacherThreads(ctx.teacherId);
  return { threads: threads.rows.map(mapThreadTeacher) };
}

export async function ensureTeacherChatWithStudent(
  user: User | undefined,
  studentId: number,
) {
  const ctx = requireTeacherSchool(user);
  const student = await repo.findStudentUser(studentId, ctx.schoolId);
  if (!student.rowCount) throw new HttpError(404, 'الطالب غير موجود');

  const owns = await repo.assertTeacherOwnsStudent(
    ctx.teacherId,
    ctx.schoolId,
    studentId,
  );
  if (!owns.rowCount) {
    throw new HttpError(403, 'هذا الطالب ليس في صفوفك');
  }

  const created = await repo.createThread(ctx.schoolId, studentId, ctx.teacherId);
  const row = created.rows[0];
  return {
    thread: {
      id: String(row.id),
      teacherId: String(row.teacher_id),
      studentId: String(row.student_id),
      studentName: student.rows[0].name,
      classroomName: null,
      lastMessage: row.last_message || 'لا رسائل بعد',
      lastAt: row.last_at,
      unread: Number(row.teacher_unread) || 0,
    },
  };
}

async function assertThreadAccess(
  threadId: number,
  role: 'student' | 'teacher',
  userId: number,
) {
  const thread = await repo.findThreadById(threadId);
  if (!thread.rowCount) throw new HttpError(404, 'المحادثة غير موجودة');
  const row = thread.rows[0];
  if (role === 'student' && row.student_id !== userId) {
    throw new HttpError(403, 'لا يمكنك فتح هذه المحادثة');
  }
  if (role === 'teacher' && row.teacher_id !== userId) {
    throw new HttpError(403, 'لا يمكنك فتح هذه المحادثة');
  }
  return row;
}

export async function getStudentMessages(user: User | undefined, threadId: number) {
  const ctx = await requireStudentCtx(user);
  await assertThreadAccess(threadId, 'student', ctx.studentId);
  await repo.markThreadRead(threadId, 'student');
  const msgs = await repo.listMessages(threadId);
  return { messages: msgs.rows.map(mapMessage) };
}

export async function getTeacherMessages(user: User | undefined, threadId: number) {
  const ctx = requireTeacherSchool(user);
  await assertThreadAccess(threadId, 'teacher', ctx.teacherId);
  await repo.markThreadRead(threadId, 'teacher');
  const msgs = await repo.listMessages(threadId);
  return { messages: msgs.rows.map(mapMessage) };
}

export async function sendStudentMessage(
  user: User | undefined,
  threadId: number,
  text: string,
) {
  const ctx = await requireStudentCtx(user);
  await assertThreadAccess(threadId, 'student', ctx.studentId);
  const body = text.trim();
  if (!body) throw new HttpError(400, 'الرسالة فارغة');
  if (body.length > 4000) throw new HttpError(400, 'الرسالة طويلة جداً');
  const msg = await repo.insertMessage(threadId, 'student', ctx.studentId, body);
  return { message: mapMessage(msg.rows[0]) };
}

export async function sendTeacherMessage(
  user: User | undefined,
  threadId: number,
  text: string,
) {
  const ctx = requireTeacherSchool(user);
  const thread = await assertThreadAccess(threadId, 'teacher', ctx.teacherId);
  const body = text.trim();
  if (!body) throw new HttpError(400, 'الرسالة فارغة');
  if (body.length > 4000) throw new HttpError(400, 'الرسالة طويلة جداً');
  const msg = await repo.insertMessage(threadId, 'teacher', ctx.teacherId, body);
  const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
  try {
    await notifyStudent({
      studentId: Number(thread.student_id),
      schoolId: ctx.schoolId,
      kind: 'message',
      title: 'رسالة من المدرس',
      body: preview,
      href: `/chat/${threadId}`,
      refType: 'chat',
      refId: threadId,
    });
  } catch {
    // Notification kind may lag a migration — chat itself still succeeds.
  }
  return { message: mapMessage(msg.rows[0]) };
}
