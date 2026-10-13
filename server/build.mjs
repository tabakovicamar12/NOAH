// Bundles the server into dist/server: main.mjs (Node host / Render), vercel.mjs (Vercel function), cli.mjs.
// Dependencies stay external and are resolved from node_modules at runtime.
import { copyFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

// Publish the open-source license notices Angular extracts next to the app, so they ship with the bundles.
if (existsSync('dist/aon/3rdpartylicenses.txt') && existsSync('dist/aon/browser')) {
  copyFileSync('dist/aon/3rdpartylicenses.txt', 'dist/aon/browser/3rdpartylicenses.txt');
}

await build({
  entryPoints: { main: 'server/main.ts', vercel: 'server/vercel.ts', cli: 'server/cli.ts' },
  outdir: 'dist/server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
