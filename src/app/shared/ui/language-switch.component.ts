import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18nService, type Lang } from '../../core/i18n/i18n.service';

@Component({
  selector: 'aon-language-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <div role="group" [attr.aria-label]="i18n.t('common.language')" class="inline-flex" [class]="onDark() ? 'ring-2 ring-inset ring-white/40' : 'ring-2 ring-inset ring-charcoal'">
      @for (l of langs; track l.code) {
        <button
          type="button"
          class="min-h-12 min-w-12 px-3 label-caps"
          [class]="i18n.lang() === l.code ? 'bg-gold text-ink' : onDark() ? 'text-white' : 'text-ink'"
          [attr.aria-pressed]="i18n.lang() === l.code"
          [attr.lang]="l.code"
          [attr.aria-label]="l.name"
          (click)="i18n.setLang(l.code)"
        >
          {{ l.short }}
        </button>
      }
    </div>
  `,
})
export class LanguageSwitchComponent {
  protected readonly i18n = inject(I18nService);
  readonly onDark = input<boolean>(false);
  protected readonly langs: ReadonlyArray<{ code: Lang; short: string; name: string }> = [
    { code: 'sl', short: 'SL', name: 'Slovenščina' },
    { code: 'en', short: 'EN', name: 'English' },
  ];
}
