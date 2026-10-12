import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { signFileKey } from './auth';
import type { ServerConfig } from './config';

/** Where photo binaries live. Supabase Storage (private bucket) in production, a folder locally. */
export interface PhotoStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A time-limited URL an <img> can load without credentials. */
  url(key: string): Promise<string | null>;
}

const URL_TTL_SECONDS = 60 * 60;

export function createPhotoStore(config: ServerConfig): PhotoStore {
  if (config.supabaseUrl && config.supabaseServiceKey) {
    return supabaseStore(config.supabaseUrl, config.supabaseServiceKey, config.photoBucket);
  }
  return localStore(config);
}

/** Supabase Storage REST API, called directly so the server needs no extra SDK. */
function supabaseStore(baseUrl: string, serviceKey: string, bucket: string): PhotoStore {
  // Supabase's new secret keys (sb_secret_…) go in `apikey` only; legacy service_role JWTs also as Bearer.
  const headers: Record<string, string> = serviceKey.startsWith('sb_secret_')
    ? { apikey: serviceKey }
    : { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const objectPath = (key: string): string => key.split('/').map(encodeURIComponent).join('/');
  return {
    async put(key, bytes, contentType) {
      const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${objectPath(key)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
    },
    async url(key) {
      const res = await fetch(`${baseUrl}/storage/v1/object/sign/${bucket}/${objectPath(key)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: URL_TTL_SECONDS }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
      const signed = body.signedURL ?? body.signedUrl;
      return signed ? `${baseUrl}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}` : null;
    },
  };
}

function localStore(config: ServerConfig): PhotoStore {
  const root = config.localPhotoDir;
  return {
    async put(key, bytes) {
      const path = safeJoin(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async url(key) {
      return `/api/v1/files?t=${encodeURIComponent(await signFileKey(config, key, URL_TTL_SECONDS))}`;
    },
  };
}

export async function readLocalPhoto(config: ServerConfig, key: string): Promise<Uint8Array | null> {
  try {
    return await readFile(safeJoin(config.localPhotoDir, key));
  } catch {
    return null;
  }
}

function safeJoin(root: string, key: string): string {
  const path = normalize(join(root, key));
  if (!path.startsWith(normalize(root) + sep)) throw new Error('Invalid storage key');
  return path;
}
