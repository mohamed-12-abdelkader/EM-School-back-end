import { Job } from 'bullmq';
import { logger } from '../../utils';
import type { EnrollmentFeeJob } from '../queues';

/** Phase 3 will generate invoices; Phase 1 records the intent event. */
export async function processEnrollmentFee(job: Job<EnrollmentFeeJob>): Promise<void> {
  logger.info({ jobId: job.id, ...job.data }, 'Enrollment fee event accepted (Phase 3 billing)');
}
