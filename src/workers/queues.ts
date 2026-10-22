import { Queue } from 'bullmq';
import { config } from '../config/env';
import { isRedisAvailable } from '../config/redis';
import { logger } from '../utils';

const connection = {
  url: config.REDIS_URL,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
};

export const ATTENDANCE_ALERTS_QUEUE = 'attendance-alerts-queue';
export const MESSAGING_FALLBACK_QUEUE = 'messaging-fallback-queue';
export const ENROLLMENT_FEE_QUEUE = 'enrollment-fee-queue';

const queues = new Map<string, Queue>();

function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection });
    queues.set(name, q);
  }
  return q;
}

async function safeAdd(queueName: string, jobName: string, data: unknown) {
  if (!isRedisAvailable()) {
    logger.debug({ queueName }, 'Skipping enqueue — Redis unavailable');
    return;
  }
  try {
    await Promise.race([
      getQueue(queueName).add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('enqueue timeout')), 2500),
      ),
    ]);
  } catch (err) {
    logger.warn({ err, queueName }, 'Failed to enqueue job');
  }
}

export type AttendanceAlertJob = {
  tenantId: string;
  studentId: string;
  status: string;
  attendanceDate: string;
};

export type MessagingFallbackJob = {
  tenantId: string;
  channel: 'PUSH' | 'WHATSAPP' | 'SMS';
  recipient: string;
  payload: Record<string, unknown>;
};

export type EnrollmentFeeJob = {
  tenantId: string;
  studentId: string;
  applicationId: string;
  familyGroupId: string;
};

export function enqueueAttendanceAlert(job: AttendanceAlertJob) {
  return safeAdd(ATTENDANCE_ALERTS_QUEUE, 'parent-alert', job);
}

export function enqueueMessagingFallback(job: MessagingFallbackJob) {
  return safeAdd(MESSAGING_FALLBACK_QUEUE, 'send', job);
}

export function enqueueEnrollmentFee(job: EnrollmentFeeJob) {
  return safeAdd(ENROLLMENT_FEE_QUEUE, 'enrollment-fee', job);
}
