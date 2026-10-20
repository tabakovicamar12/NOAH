import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../core/i18n/i18n.service';
import { LogoComponent } from '../shared/ui/logo.component';

@Component({
  selector: 'aon-not-found',
  imports: [RouterLink, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="grid min-h-dvh place-items-center px-4">
      <div class="w-full max-w-sm rounded-xl border border-[var(--color-line)] bg-white px-6 py-8 text-center shadow-[0_8px_24px_-18px_rgb(20_20_20/0.25)]">
        <aon-logo [size]="1.3" />
        <h1 class="mt-5 text-[clamp(1.35rem,1.2rem+0.6vw,1.65rem)] font-semibold tracking-tight">{{ i18n.t('notFound.title') }}</h1>
        <a routerLink="/" class="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-gold px-5 font-semibold text-charcoal no-underline">
          {{ i18n.t('notFound.home') }}
        </a>
      </div>
    </main>
  `,
})
export class NotFoundComponent {
  protected readonly i18n = inject(I18nService);
}
