import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../core/i18n/i18n.service';
import { LogoComponent } from '../shared/ui/logo.component';

@Component({
  selector: 'aon-not-found',
  imports: [RouterLink, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="grid min-h-dvh place-items-center bg-ground px-4">
      <div class="text-center">
        <aon-logo [size]="2.5" />
        <h1 class="mt-6 font-cond text-5xl">{{ i18n.t('notFound.title') }}</h1>
        <a routerLink="/" class="mt-8 inline-flex min-h-14 items-center bg-charcoal px-6 font-cond text-xl text-white no-underline">
          {{ i18n.t('notFound.home') }}
        </a>
      </div>
    </main>
  `,
})
export class NotFoundComponent {
  protected readonly i18n = inject(I18nService);
}
