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
  const ext = (params.contentType || 'application/octet-stream').includes('pdf')
    ? 'pdf'
    : (params.contentType || '').includes('image')
      ? 'jpg'
      : 'bin';
  const path = `${params.tenantId}/${params.applicationId}/${params.documentType}-${randomUUID()}.${ext}`;

  // Dev / Phase 1 fallback when Storage credentials are missing
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      path: `local://${path}`,
      token: 'local-dev',
      signedUrl: null as string | null,
      storageMode: 'local' as const,
      expiresIn: params.expiresInSeconds ?? 3600,
    };
  }

  try {
    const client = getAdminClient();
    const { data, error } = await client.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      // Bucket missing / RLS / network — keep admissions usable in Phase 1
      return {
        path: `local://${path}`,
        token: 'local-dev',
        signedUrl: null as string | null,
        storageMode: 'local' as const,
        expiresIn: params.expiresInSeconds ?? 3600,
        warning: error?.message || 'Storage unavailable — using local document registry',
      };
    }

    return {
      path,
      token: data.token,
      signedUrl: data.signedUrl as string,
      storageMode: 'supabase' as const,
      expiresIn: params.expiresInSeconds ?? 3600,
    };
  } catch (err) {
    return {
      path: `local://${path}`,
      token: 'local-dev',
      signedUrl: null as string | null,
      storageMode: 'local' as const,
      expiresIn: params.expiresInSeconds ?? 3600,
      warning: err instanceof Error ? err.message : 'Storage unavailable',
    };
  }
}

export async function createDownloadUrl(path: string, expiresInSeconds = 3600) {
  if (path.startsWith('local://') || !config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    return { path, signedUrl: null as string | null, expiresIn: expiresInSeconds, storageMode: 'local' as const };
  }

  const client = getAdminClient();
  const { data, error } = await client.storage
    .from(config.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new HttpError(500, error?.message || 'Failed to create download URL');
  }

  return { path, signedUrl: data.signedUrl, expiresIn: expiresInSeconds, storageMode: 'supabase' as const };
}
