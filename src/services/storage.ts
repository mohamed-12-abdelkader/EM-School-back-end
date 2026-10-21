import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env';
import { HttpError } from '../utils';

let supabaseAdmin: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(503, 'Supabase Storage is not configured');
  }
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

export async function createUploadUrl(params: {
  tenantId: string;
  applicationId: string;
  documentType: string;
  contentType?: string;
  expiresInSeconds?: number;
}) {
  const client = getAdminClient();
  const ext = (params.contentType || 'application/octet-stream').includes('pdf') ? 'pdf' : 'bin';
  const path = `${params.tenantId}/${params.applicationId}/${params.documentType}-${randomUUID()}.${ext}`;

  const { data, error } = await client.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new HttpError(500, error?.message || 'Failed to create upload URL');
  }

  return {
    path,
    token: data.token,
    signedUrl: data.signedUrl,
    expiresIn: params.expiresInSeconds ?? 3600,
  };
}

export async function createDownloadUrl(path: string, expiresInSeconds = 3600) {
  const client = getAdminClient();
  const { data, error } = await client.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new HttpError(500, error?.message || 'Failed to create download URL');
  }

  return { path, signedUrl: data.signedUrl, expiresIn: expiresInSeconds };
}
