import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { IconComponent } from '../shared/ui/icon.component';
import { LogoComponent } from '../shared/ui/logo.component';

@Component({
  selector: 'aon-storage-unavailable',
  imports: [IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="grid min-h-dvh place-items-center bg-charcoal px-4 py-10 text-white">
      <div class="w-full max-w-lg">
        <aon-logo [size]="2.5" />
        <div class="mt-8 border-2 border-hold bg-stock p-6 text-ink">
          <aon-icon name="alert" [size]="36" class="text-hold" />
          <h1 class="mt-3 font-cond text-3xl leading-tight">{{ i18n.t('storage.title') }}</h1>
          <p class="mt-3 text-lg leading-relaxed">{{ i18n.t('storage.body') }}</p>
          @if (detail()) {
            <p class="mt-3 text-sm text-ink-muted">{{ i18n.t('storage.detail', { detail: detail() ?? '' }) }}</p>
          }
          <button type="button" class="mt-6 min-h-14 w-full bg-charcoal px-5 font-cond text-xl text-white" (click)="reload()">
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
