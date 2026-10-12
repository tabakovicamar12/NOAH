import { ErrorHandler, Injectable, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { ToastService } from './toast.service';

/**
 * Last line of defence: anything that escapes a try/catch is logged and surfaced calmly.
 * Field data lives in IndexedDB, so an uncaught error never loses entries; the toast says so.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private lastShownAt = 0;

  handleError(error: unknown): void {
    console.error('[AON] Unhandled error', error);
    const now = Date.now();
    if (now - this.lastShownAt > 5000) {
      this.lastShownAt = now;
      try {
        this.toast.error(this.i18n.t('common.unexpected'));
      } catch {
        /* never throw from the error handler */
      }
    }
  }
}
