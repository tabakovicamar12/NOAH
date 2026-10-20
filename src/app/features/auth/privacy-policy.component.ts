import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { OrgService } from '../../core/org/org.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { IconComponent } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { LogoComponent } from '../../shared/ui/logo.component';

@Component({
  selector: 'aon-privacy-policy',
  imports: [IconComponent, LanguageSwitchComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-10 bg-[var(--color-rail)] pt-[env(safe-area-inset-top)] text-[var(--color-rail-text)]">
      <div class="mx-auto flex min-h-14 max-w-3xl items-center justify-between gap-3 px-4">
        <button type="button" class="-ml-2 flex min-h-11 items-center gap-1.5 rounded-lg px-2 font-medium hover:bg-white/10" (click)="back()">
          <aon-icon name="arrow-left" [size]="18" />{{ i18n.t('common.back') }}
        </button>
        <aon-logo [size]="1.2" class="max-[359px]:hidden" />
        <aon-language-switch [onDark]="true" />
      </div>
    </header>
    <main class="mx-auto max-w-3xl px-4 pb-16 pt-7 sm:pt-10">
      <h1 class="text-[clamp(1.6rem,1.3rem+1.2vw,2.09rem)] font-semibold leading-tight tracking-tight">{{ i18n.t('privacy.title') }}</h1>
      @if (!org.configured()) {
        <p class="mt-4 rounded-lg border border-[rgb(193_160_80/0.55)] bg-[var(--color-gold-fill)] px-4 py-3 text-[0.95rem] text-[var(--color-gold-ink)]">{{ i18n.t('privacy.draft') }}</p>
      }
      <div class="mt-6 rounded-xl border border-[var(--color-line)] bg-white px-5 py-2 shadow-[0_8px_24px_-18px_rgb(20_20_20/0.25)] sm:px-7">
        @for (s of sections; track s.title) {
          <section class="border-b border-[var(--color-line)] py-5 last:border-b-0">
            <h2 class="text-[1.08rem] font-semibold">{{ i18n.t(s.title) }}</h2>
            @if (s.title === 'privacy.whoTitle' && org.info(); as o) {
              @if (o.name) {
                <dl class="mt-2 grid gap-1 text-[var(--color-text)]">
                  <div><dt class="sr-only">{{ i18n.t('privacy.orgName') }}</dt><dd class="font-semibold">{{ o.name }}</dd></div>
                  @if (o.address) {
                    <div><dt class="sr-only">{{ i18n.t('privacy.orgAddress') }}</dt><dd>{{ o.address }}</dd></div>
                  }
                  @if (o.taxId) {
                    <div class="flex gap-1.5"><dt>{{ i18n.t('privacy.orgTaxId') }}:</dt><dd>{{ o.taxId }}</dd></div>
                  }
                  @if (o.privacyContact) {
                    <div class="flex flex-wrap gap-1.5"><dt>{{ i18n.t('privacy.orgContact') }}:</dt><dd>{{ o.privacyContact }}</dd></div>
                  }
                  @if (o.dpo) {
                    <div class="flex flex-wrap gap-1.5"><dt>{{ i18n.t('privacy.orgDpo') }}:</dt><dd>{{ o.dpo }}</dd></div>
                  }
                </dl>
              }
            }
            <p class="mt-1.5 max-w-[68ch] leading-relaxed text-[var(--color-text)]">{{ body(s.body) }}</p>
          </section>
        }
      </div>
    </main>
  `,
})
export class PrivacyPolicyComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly org = inject(OrgService);
  private readonly location = inject(Location);

  constructor() {
    void this.org.load();
  }

  /** Retention names the configured photo period when there is one. */
  protected body(key: TranslationKey): string {
    const days = this.org.info()?.photoRetentionDays;
    if (key === 'privacy.retention' && days) return this.i18n.t('privacy.retentionDays', { days });
    return this.i18n.t(key);
  }
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
