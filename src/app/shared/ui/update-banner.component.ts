import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from './icon.component';

const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Tells the crew when a new version of the installed PWA is ready. Updating reloads the page; nothing is
 * lost because every entry already lives in the device database.
 */
@Component({
  selector: 'aon-update-banner',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ready()) {
      <div
        class="no-print fixed inset-x-0 bottom-[calc(6.2rem+env(safe-area-inset-bottom))] z-[65] mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl bg-[var(--color-rail)] px-4 py-3 text-white shadow-[0_16px_40px_-16px_rgb(20_20_20/0.5)] lg:bottom-6 lg:right-6 lg:left-auto lg:mx-0"
        role="status"
      >
        <span class="flex items-center gap-2 font-semibold"><aon-icon name="refresh" [size]="20" class="text-gold" />{{ i18n.t('pwa.update') }}</span>
        <button type="button" class="min-h-11 shrink-0 rounded-lg bg-gold px-4 font-semibold text-charcoal" (click)="apply()">{{ i18n.t('pwa.reload') }}</button>
      </div>
    }
  `,
})
export class UpdateBannerComponent {
  protected readonly i18n = inject(I18nService);
  private readonly sw = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  protected readonly ready = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe((e: VersionEvent) => {
      if (e.type === 'VERSION_READY') this.ready.set(true);
    });
    const timer = setInterval(() => void this.sw.checkForUpdate().catch(() => undefined), CHECK_EVERY_MS);
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      sub.unsubscribe();
      clearInterval(timer);
    });
    // A broken cache (e.g. files deleted from the server) cannot be healed in place: reload clean.
    this.sw.unrecoverable.subscribe(() => this.document.location.reload());
  }

  protected async apply(): Promise<void> {
    try {
      await this.sw.activateUpdate();
    } finally {
      this.document.location.reload();
    }
  }
}
