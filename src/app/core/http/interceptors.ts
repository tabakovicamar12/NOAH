import { HttpErrorResponse, type HttpEvent, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TimeoutError, catchError, tap, throwError, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiError, type ApiErrorKind } from '../models/api.models';
import { NetworkStatusService } from '../network/network-status.service';
import { SessionStore } from '../auth/session.store';

function isApiCall(url: string): boolean {
  return url.startsWith(environment.apiBaseUrl);
}

/** Adds the bearer token to API calls. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiCall(req.url)) return next(req);
  const token = inject(SessionStore).token();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

/**
 * Resilience layer for every API call:
 * - short-circuits when offline is simulated (behaves exactly like a dead network),
 * - enforces a timeout,
 * - feeds reachability to NetworkStatusService,
 * - maps every failure to a typed ApiError so callers never see raw HttpErrorResponse.
 */
export const resilienceInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiCall(req.url)) return next(req);
  const network = inject(NetworkStatusService);
  const session = inject(SessionStore);

  if (network.simulatedOffline()) {
    return throwError(() => new ApiError('NETWORK', 0, 'Offline (simulated)'));
  }

  return next(req).pipe(
    timeout(environment.requestTimeoutMs),
    tap<HttpEvent<unknown>>(() => network.reportReachable()),
    catchError((err: unknown) => {
      const apiError = toApiError(err);
      if (apiError.kind === 'NETWORK' || apiError.kind === 'TIMEOUT') {
        network.reportUnreachable();
      } else {
        network.reportReachable();
      }
      if (apiError.kind === 'UNAUTHORIZED' && !req.url.endsWith('/auth/login')) {
        session.expired.set(true);
      }
      return throwError(() => apiError);
    }),
  );
};

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof TimeoutError) return new ApiError('TIMEOUT', 0, 'Request timed out');
  if (err instanceof HttpErrorResponse) {
    const kind: ApiErrorKind =
      err.status === 0
        ? 'NETWORK'
        : err.status === 401 || err.status === 403
          ? 'UNAUTHORIZED'
          : err.status === 404
            ? 'NOT_FOUND'
            : err.status === 409
              ? 'CONFLICT'
              : err.status >= 400 && err.status < 500
                ? 'VALIDATION'
                : 'SERVER';
    const body: unknown = err.error;
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : err.message;
    return new ApiError(kind, err.status, message);
  }
  return new ApiError('SERVER', 0, err instanceof Error ? err.message : 'Unknown error');
}
