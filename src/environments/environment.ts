import type { AonEnvironment } from './environment.model';

/** Production: the real AON API, served from the same origin under /api/v1 (Render, Vercel). */
export const environment: AonEnvironment = {
  production: true,
  apiBaseUrl: '/api/v1',
  useMockBackend: false,
  requestTimeoutMs: 20_000,
  heartbeatMs: 30_000,
  privacyContact: 'zasebnost@noah.si',
};
