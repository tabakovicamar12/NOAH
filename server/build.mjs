// Bundles the server into dist/server: main.mjs (Node host / Render), vercel.mjs (Vercel function), cli.mjs.
// Dependencies stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';

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
