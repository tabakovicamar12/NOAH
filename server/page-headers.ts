/**
 * Security headers for the app's pages, outside /api (which gets Hono's secureHeaders). The camera and the
 * microphone stay usable by the app itself; location is switched off, since AON never reads device position.
 * Keep in step with the "headers" block in vercel.json.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
