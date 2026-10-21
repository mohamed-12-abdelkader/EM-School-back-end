import { Job } from 'bullmq';
import pool from '../../db/pool';
import { logger } from '../../utils';
import { config } from '../../config/env';
import type { AttendanceAlertJob } from '../queues';
import { enqueueMessagingFallback } from '../queues';

export async function processAttendanceAlert(job: Job<AttendanceAlertJob>): Promise<void> {
  const { tenantId, studentId, status, attendanceDate } = job.data;

  const guardians = await pool.query(
    `SELECT g.phone, g.email, g.user_id, s.full_name
     FROM students s
     JOIN student_guardians g ON g.family_group_id = s.family_group_id AND g.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1 AND s.id = $2 AND g.is_emergency_contact = TRUE`,
    [tenantId, studentId],
  );

  for (const g of guardians.rows) {
    const payload = {
      type: 'ATTENDANCE_ALERT',
      studentId,
      studentName: g.full_name,
      status,
      attendanceDate,
    };

    await pool.query(
      `INSERT INTO notification_outbox (tenant_id, channel, recipient, payload, related_type, related_id)
       VALUES ($1, 'PUSH', $2, $3::jsonb, 'attendance', $4)`,
      [tenantId, g.user_id || g.phone || g.email || 'unknown', JSON.stringify(payload), studentId],
    );

    // Push first; fallback channels enqueued for unacked offline paths
    await enqueueMessagingFallback({
      tenantId,
      channel: 'PUSH',
      recipient: String(g.user_id || g.phone || g.email),
      payload,
    });

    if (g.phone && config.WHATSAPP_API_URL) {
      await enqueueMessagingFallback({
        tenantId,
        channel: 'WHATSAPP',
        recipient: g.phone,
        payload,
      });
    } else if (g.phone && config.SMS_GATEWAY_URL) {
      await enqueueMessagingFallback({
        tenantId,
        channel: 'SMS',
        recipient: g.phone,
        payload,
      });
    }
  }

  logger.info({ jobId: job.id, studentId, status }, 'Attendance alerts dispatched');
}
