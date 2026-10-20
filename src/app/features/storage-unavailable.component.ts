import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { IconComponent } from '../shared/ui/icon.component';
import { LogoComponent } from '../shared/ui/logo.component';

@Component({
  selector: 'aon-storage-unavailable',
  imports: [IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="grid min-h-dvh place-items-center bg-[var(--color-rail)] px-4 py-10 text-[var(--color-rail-text)]">
      <div class="w-full max-w-lg">
        <aon-logo [size]="1.45" />
        <div class="mt-6 rounded-xl bg-white p-6 text-ink shadow-[0_16px_40px_-16px_rgb(0_0_0/0.5)]">
          <aon-icon name="alert" [size]="24" class="text-[var(--color-bad)]" />
          <h1 class="mt-3 text-[clamp(1.3rem,1.15rem+0.6vw,1.6rem)] font-semibold leading-tight tracking-tight">{{ i18n.t('storage.title') }}</h1>
          <p class="mt-2 leading-relaxed">{{ i18n.t('storage.body') }}</p>
          @if (detail()) {
            <p class="mt-3 text-sm text-ink-muted">{{ i18n.t('storage.detail', { detail: detail() ?? '' }) }}</p>
          }
          <button type="button" class="mt-5 min-h-12 w-full rounded-lg bg-gold px-5 font-semibold text-charcoal" (click)="reload()">
            {{ i18n.t('common.retry') }}
          </button>
        </div>
      </div>
    </main>
  `,
})
export class StorageUnavailableComponent {
  protected readonly i18n = inject(I18nService);
  readonly detail = input<string | null>(null);

  protected reload(): void {
    location.reload();
  }
}
