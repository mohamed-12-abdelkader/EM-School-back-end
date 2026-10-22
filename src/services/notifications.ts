import pool from '../db/pool';
import { logger } from '../utils';

/** Persist an in-app / omnichannel notification even when Redis workers are down. */
export async function writeOutbox(params: {
  tenantId: string;
  channel: 'PUSH' | 'WHATSAPP' | 'SMS';
  recipient: string;
  payload: Record<string, unknown>;
  relatedType?: string;
  relatedId?: string | null;
}) {
  try {
    await pool.query(
      `INSERT INTO notification_outbox (
         tenant_id, channel, recipient, payload, related_type, related_id, status
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,'PENDING')`,
      [
        params.tenantId,
        params.channel,
        params.recipient,
        JSON.stringify(params.payload),
        params.relatedType ?? null,
        params.relatedId ?? null,
      ],
    );
  } catch (err) {
    logger.warn({ err, params }, 'Failed to write notification_outbox');
  }
}
