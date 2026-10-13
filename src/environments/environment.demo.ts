import type { AonEnvironment } from './environment.model';

/** Presentation build (`npm run start:demo`): an in-browser mock answers every call, no server needed. */
export const environment: AonEnvironment = {
  production: false,
  apiBaseUrl: '/api/v1',
  useMockBackend: true,
  requestTimeoutMs: 15_000,
  heartbeatMs: 30_000,
};
