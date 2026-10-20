import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { relative } from 'node:path';
import { createApp } from './app';
import { loadConfig } from './config';
import { getDb } from './db';
import { loadDotEnv } from './env-file';
import { migrate } from './migrations';
import { PAGE_HEADERS } from './page-headers';

/**
 * Long-running server (Render, any Node host, local development).
 * Serves the API under /api/v1 and, when the Angular build exists, the PWA itself with SPA fallback.
 */
loadDotEnv();
const config = loadConfig();
const app = createApp(config);

if (config.staticDir) {
  const root = relative(process.cwd(), config.staticDir) || '.';
  // The service worker and its manifest must never be cached, or clients get stuck on an old version.
  app.use('*', async (c, next) => {
    await next();
    const path = c.req.path;
    if (!path.startsWith('/api/')) for (const [k, v] of Object.entries(PAGE_HEADERS)) c.header(k, v);
    if (path === '/ngsw-worker.js' || path === '/ngsw.json' || path === '/index.html' || path === '/') {
      c.header('Cache-Control', 'no-cache');
    } else if (/-[A-Za-z0-9_]{8}\.(js|css)$/.test(path)) {
      // Angular's content-hashed bundles never change under the same name.
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    }
  });
  app.use('*', serveStatic({ root }));
  // Deep links (/w/orders/…, /m/…) load the app shell; the Angular router takes it from there.
  // Unknown /api paths stay JSON 404s.
  app.get('*', async (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ root, path: 'index.html' })(c, next)));
}

const db = await getDb(config);
await migrate(db, (m) => console.log(`[AON] migration ${m}`));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[AON] listening on http://localhost:${info.port} (${config.databaseUrl ? 'Postgres' : 'PGlite ' + config.pgliteDir})`);
  if (config.staticDir) console.log(`[AON] serving app from ${config.staticDir}`);
  if (config.production && !config.org.name) console.warn('[AON] ORG_NAME is not set: the privacy notice does not name the employer yet.');
});
