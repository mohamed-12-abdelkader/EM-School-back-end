import { Worker } from 'bullmq';
import { config } from '../config/env';
import { logger } from '../utils';
import {
  ATTENDANCE_ALERTS_QUEUE,
  ENROLLMENT_FEE_QUEUE,
  MESSAGING_FALLBACK_QUEUE,
} from './queues';
import { processAttendanceAlert } from './processors/attendanceAlerts';
import { processMessagingFallback } from './processors/messagingFallback';
import { processEnrollmentFee } from './processors/enrollmentFee';

const connection = { url: config.REDIS_URL };
let workersStarted = false;

export function startWorkers(): void {
  if (workersStarted) return;
  workersStarted = true;

  const workers = [
    new Worker(ATTENDANCE_ALERTS_QUEUE, processAttendanceAlert, { connection, concurrency: 5 }),
    new Worker(MESSAGING_FALLBACK_QUEUE, processMessagingFallback, { connection, concurrency: 5 }),
    new Worker(ENROLLMENT_FEE_QUEUE, processEnrollmentFee, { connection, concurrency: 2 }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      logger.error({ queue: w.name, jobId: job?.id, err }, 'Worker job failed');
    });
    w.on('error', (err) => {
      logger.warn({ queue: w.name, err: err.message }, 'Worker error');
    });
  }

  logger.info('BullMQ Phase 1 workers ready');
}
