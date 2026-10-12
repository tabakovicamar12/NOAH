import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { IconComponent } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { LogoComponent } from '../../shared/ui/logo.component';

@Component({
  selector: 'aon-privacy-policy',
  imports: [IconComponent, LanguageSwitchComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-10 bg-charcoal pt-[env(safe-area-inset-top)] text-white">
      <div class="mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3 px-4">
        <button type="button" class="-ml-2 flex min-h-12 items-center gap-2 px-2 font-cond text-lg" (click)="back()">
          <aon-icon name="arrow-left" [size]="24" />{{ i18n.t('common.back') }}
        </button>
        <aon-logo [size]="1.5" />
        <aon-language-switch [onDark]="true" />
      </div>
    </header>
    <main class="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <h1 class="font-cond text-5xl leading-none">{{ i18n.t('privacy.title') }}</h1>
      <p class="mt-4 border-2 border-dashed border-charcoal bg-gold-pale px-4 py-3 font-semibold">{{ i18n.t('privacy.draft') }}</p>
      @for (s of sections; track s.title) {
        <section class="mt-10">
          <h2 class="font-cond text-2xl">{{ i18n.t(s.title) }}</h2>
          <p class="mt-2 max-w-[68ch] text-lg leading-relaxed">{{ i18n.t(s.body, { contact: contact }) }}</p>
        </section>
      }
    </main>
  `,
})
export class PrivacyPolicyComponent {
  protected readonly i18n = inject(I18nService);
  private readonly location = inject(Location);
  protected readonly contact = environment.privacyContact;
  protected readonly sections: ReadonlyArray<{ title: TranslationKey; body: TranslationKey }> = [
    { title: 'privacy.whoTitle', body: 'privacy.who' },
    { title: 'privacy.whatTitle', body: 'privacy.what' },
    { title: 'privacy.notTitle', body: 'privacy.not' },
    { title: 'privacy.whyTitle', body: 'privacy.why' },
    { title: 'privacy.cameraTitle', body: 'privacy.camera' },
    { title: 'privacy.voiceTitle', body: 'privacy.voice' },
    { title: 'privacy.deviceTitle', body: 'privacy.device' },
    { title: 'privacy.processorsTitle', body: 'privacy.processors' },
    { title: 'privacy.retentionTitle', body: 'privacy.retention' },
    { title: 'privacy.rightsTitle', body: 'privacy.rights' },
  ];

  protected back(): void {
    this.location.back();
  }
}
