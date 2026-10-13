import type { AonEnvironment } from './environment.model';

/** Local development: `npm run dev:api` serves the API on :8787; the dev server proxies /api to it. */
export const environment: AonEnvironment = {
  production: false,
  apiBaseUrl: '/api/v1',
  useMockBackend: false,
  requestTimeoutMs: 20_000,
  heartbeatMs: 30_000,
};
