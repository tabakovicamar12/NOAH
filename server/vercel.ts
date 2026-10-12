import { handle } from '@hono/node-server/vercel';
import { createApp } from './app';
import { loadConfig } from './config';
import { releaseDb } from './db';

/**
 * Vercel serverless entry (Node runtime). Vercel serves the PWA from its CDN; this function answers /api/*.
 * Migrations are not run here: run `npm run cli -- migrate` once against Supabase before deploying.
 */

// A small pool per instance: one request opens at most two connections to the transaction pooler.
process.env['DB_POOL_MAX'] ??= '2';

const app = createApp(loadConfig());
const handler = handle(app);

// Requests share the pool while they overlap; once none is running the pool is released, so a frozen
// instance never resumes on dead database sockets (see releaseDb).
let inFlight = 0;

export default async function aon(...args: Parameters<typeof handler>): Promise<Awaited<ReturnType<typeof handler>>> {
  inFlight++;
  try {
    return await handler(...args);
  } finally {
    if (--inFlight === 0) releaseDb();
  }
}
