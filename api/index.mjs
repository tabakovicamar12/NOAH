// Vercel serverless function: answers every /api/* request (see the rewrites in vercel.json).
// The server is bundled by `npm run build` into dist/server before Vercel packages this function.
export { default } from '../dist/server/vercel.mjs';
