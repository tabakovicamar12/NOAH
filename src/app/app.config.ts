import { provideHttpClient, withInterceptors, type HttpInterceptorFn } from '@angular/common/http';
import {
  ErrorHandler,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  type ApplicationConfig,
} from '@angular/core';
import { PreloadAllModules, provideRouter, withComponentInputBinding, withInMemoryScrolling, withPreloading } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { DatabaseService } from './core/db/database.service';
import { authInterceptor, resilienceInterceptor } from './core/http/interceptors';
import { NetworkStatusService } from './core/network/network-status.service';
import { SyncEngine } from './core/sync/sync-engine.service';
import { GlobalErrorHandler } from './core/ui/global-error-handler';
import { mockBackendInterceptor } from './mock-backend/mock-backend.interceptor';

/** The mock backend must be the LAST interceptor: it stands in for the network. */
const interceptors: HttpInterceptorFn[] = [authInterceptor, resilienceInterceptor];
if (environment.useMockBackend) interceptors.push(mockBackendInterceptor);

async function bootstrapDevice(): Promise<void> {
  const database = inject(DatabaseService);
  const auth = inject(AuthService);
  const sync = inject(SyncEngine);
  const network = inject(NetworkStatusService);
  await database.open();
  if (database.state() !== 'READY') return;
  await auth.restore();
  void network.probe();
  sync.start();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideHttpClient(withInterceptors(interceptors)),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      // Every screen loads in the background after start, so a tap on the dock opens it at once, also offline.
      withPreloading(PreloadAllModules),
    ),
    provideAppInitializer(bootstrapDevice),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
