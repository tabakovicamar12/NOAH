import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { EN } from './en';
import { SL, type Dictionary, type TranslationKey } from './sl';

export type Lang = 'sl' | 'en';
export type TranslationParams = Readonly<Record<string, string | number>>;

const STORAGE_KEY = 'aon.lang';
const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { sl: SL, en: EN };
const LOCALES: Readonly<Record<Lang, string>> = { sl: 'sl-SI', en: 'en-GB' };
const PLURAL_ORDER: Readonly<Record<Lang, readonly Intl.LDMLPluralRule[]>> = {
  sl: ['one', 'two', 'few', 'other'],
  en: ['one', 'other'],
};

/**
 * Runtime bilingual support (Slovenian primary, English). Signal-based so templates re-render on switch
 * without a reload; field crews switch language on a shared device mid-shift.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);
  readonly lang = signal<Lang>(this.readStoredLang());
  readonly locale = computed(() => LOCALES[this.lang()]);

  private readonly timeFmt = computed(() => new Intl.DateTimeFormat(this.locale(), { hour: '2-digit', minute: '2-digit' }));
  private readonly dateFmt = computed(
    () => new Intl.DateTimeFormat(this.locale(), { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }),
  );
  private readonly dateLongFmt = computed(
    () => new Intl.DateTimeFormat(this.locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  );
  private readonly pluralRules = computed(() => new Intl.PluralRules(this.locale()));
  private readonly numberFmt = computed(() => new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 1 }));

  constructor() {
    effect(() => {
      const lang = this.lang();
      this.document.documentElement.lang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        /* storage blocked: preference lasts for this session only */
      }
    });
  }

  /**
   * Translate a key. Reads the `lang` signal, so calling it in a template tracks language changes.
   * `{n|form|form…}` picks the word form for the count in param `n`, in the language's CLDR plural order:
   * Slovenian one|two|few|other (1 vnos, 2 vnosa, 3 vnosi, 5 vnosov), English one|other.
   */
  readonly t = (key: TranslationKey, params?: TranslationParams): string => {
    const template = DICTIONARIES[this.lang()][key] ?? SL[key] ?? key;
    if (!params) return template;
    const rules = this.pluralRules();
    const order = PLURAL_ORDER[this.lang()];
    const withPlurals = template.replace(/\{(\w+)\|([^}]*)\}/g, (match, name: string, forms: string) => {
      const count = Number(params[name]);
      if (!Number.isFinite(count)) return match;
      const list = forms.split('|');
      const index = order.indexOf(rules.select(count));
      return list[index >= 0 ? index : list.length - 1] ?? list[list.length - 1] ?? '';
    });
    return withPlurals.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      return value === undefined ? match : String(value);
    });
  };

  setLang(lang: Lang): void {
    this.lang.set(lang);
  }

  toggle(): void {
    this.lang.update((l) => (l === 'sl' ? 'en' : 'sl'));
  }

  time(ms: number | null | undefined): string {
    return ms == null ? '—' : this.timeFmt().format(new Date(ms));
  }

  date(isoOrMs: string | number): string {
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(`${isoOrMs}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '—' : this.dateFmt().format(d);
  }

  dateLong(isoOrMs: string | number): string {
    const d = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(`${isoOrMs}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '—' : this.dateLongFmt().format(d);
  }

  number(n: number): string {
    return this.numberFmt().format(n);
  }

  private readStoredLang(): Lang {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'sl' || stored === 'en') return stored;
    } catch {
      /* ignore */
    }
    return 'sl';
  }
}
