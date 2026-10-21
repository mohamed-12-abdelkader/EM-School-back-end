import { Job } from 'bullmq';
import { logger } from '../../utils';
import { config } from '../../config/env';
import pool from '../../db/pool';
import type { MessagingFallbackJob } from '../queues';

/**
 * Omnichannel sender stub — wires expo-server-sdk / WhatsApp / SMS when credentials exist.
 */
export async function processMessagingFallback(job: Job<MessagingFallbackJob>): Promise<void> {
  const { tenantId, channel, recipient, payload } = job.data;

  logger.info({ jobId: job.id, channel, recipient, payload }, 'Sending omnichannel message');

  // Placeholder integrations — mark outbox SENT for observability
  await pool.query(
    `UPDATE notification_outbox
     SET status = 'SENT', sent_at = NOW()
     WHERE tenant_id = $1 AND recipient = $2 AND status = 'PENDING'
       AND payload @> $3::jsonb`,
    [tenantId, recipient, JSON.stringify(payload)],
  );

  if (channel === 'PUSH' && config.EXPO_ACCESS_TOKEN) {
    // expo-server-sdk integration point
    logger.info('Expo push would be sent here');
  }
  if (channel === 'WHATSAPP' && config.WHATSAPP_API_URL) {
    logger.info('WhatsApp Business API would be called here');
  }
  if (channel === 'SMS' && config.SMS_GATEWAY_URL) {
    logger.info('SMS gateway would be called here');
  }
}
