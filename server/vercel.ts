import { handle } from '@hono/node-server/vercel';
import { createApp } from './app';
import { loadConfig } from './config';

/**
 * Vercel serverless entry (Node runtime). Vercel serves the PWA from its CDN; this function answers /api/*.
 * Migrations are not run here: run `npm run cli -- migrate` once against Supabase before deploying.
 */
const app = createApp(loadConfig());
export default handle(app);
