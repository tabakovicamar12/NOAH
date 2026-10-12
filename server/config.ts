import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runtime configuration, read once from the environment.
 * Production (Render, Vercel) talks to Supabase: Postgres through DATABASE_URL, photos through Storage.
 * Local development without DATABASE_URL runs an embedded Postgres (PGlite) under .data/.
 */
export interface ServerConfig {
  readonly production: boolean;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly pgliteDir: string;
  readonly jwtSecret: Uint8Array;
  readonly tokenTtlHours: number;
  readonly supabaseUrl: string | null;
  readonly supabaseServiceKey: string | null;
  readonly photoBucket: string;
  readonly localPhotoDir: string;
  readonly staticDir: string | null;
  readonly corsOrigins: readonly string[];
  readonly maxPhotoBytes: number;
}

const DEV_SECRET = 'aon-local-development-secret-not-for-production';

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : null;
}

export function loadConfig(): ServerConfig {
  const production = process.env['NODE_ENV'] === 'production';
  const secret = env('JWT_SECRET');
  if (production && (!secret || secret.length < 32)) {
    throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
  }
  const databaseUrl = env('DATABASE_URL');
  if (production && !databaseUrl) {
    throw new Error('DATABASE_URL must be set in production (Supabase → Connect → Transaction pooler).');
  }
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseServiceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (production && (!supabaseUrl || !supabaseServiceKey)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in production (photo storage).');
  }
  const builtFrontend = resolve(process.cwd(), 'dist/aon/browser');
  return {
    production,
    port: Number(env('PORT') ?? 8787),
    databaseUrl,
    pgliteDir: env('PGLITE_DIR') ?? resolve(process.cwd(), '.data/pglite'),
    jwtSecret: new TextEncoder().encode(secret ?? DEV_SECRET),
    tokenTtlHours: Number(env('TOKEN_TTL_HOURS') ?? 168),
    supabaseUrl: supabaseUrl?.replace(/\/+$/, '') ?? null,
    supabaseServiceKey,
    photoBucket: env('SUPABASE_PHOTO_BUCKET') ?? 'photos',
    localPhotoDir: env('LOCAL_PHOTO_DIR') ?? resolve(process.cwd(), '.data/photos'),
    staticDir: env('STATIC_DIR') ?? (existsSync(builtFrontend) ? builtFrontend : null),
    corsOrigins: (env('CORS_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Vercel functions accept request bodies up to 4.5 MB; the app stores photos at ≤ 2048 px JPEG (~0.5–1.5 MB).
    maxPhotoBytes: Number(env('MAX_PHOTO_BYTES') ?? 4 * 1024 * 1024),
  };
}
