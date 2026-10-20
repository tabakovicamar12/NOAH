import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { WorkerStore, type SiteOption } from './data/worker-store.service';

/**
 * ZAČNI DELO: which object is the worker on? One tap on an object starts the shift there. Objects of the
 * worker's open orders come first; every other active object is below, with a search once the list is long.
 */
@Component({
  selector: 'aon-site-picker',
  imports: [NgTemplateOutlet, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="sheet m-auto mb-0 max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto border-0 bg-white p-0 text-ink backdrop:bg-charcoal/60 sm:mb-auto"
      aria-labelledby="site-picker-title"
      (cancel)="$event.preventDefault(); store.resolveSite(undefined)"
    >
      <div class="flex items-center gap-3 px-5 pb-2 pt-5">
        <span class="badge"><aon-icon name="pin" [size]="20" [stroke]="2" /></span>
        <h2 id="site-picker-title" class="text-lg font-semibold leading-tight">{{ i18n.t('site.pickTitle') }}</h2>
      </div>
      <p class="px-5 text-[0.95rem] leading-snug text-[var(--color-text-muted)]">{{ i18n.t('site.pickHint') }}</p>

      @if (store.siteOptions().length > 8) {
        <label class="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-[var(--color-line-strong)] px-3">
          <aon-icon name="search" [size]="18" class="text-[var(--color-text-muted)]" />
          <span class="sr-only">{{ i18n.t('site.search') }}</span>
          <input
            type="search"
            class="min-h-12 w-full bg-transparent outline-none"
            [placeholder]="i18n.t('site.search')"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </label>
      }

      @if (assigned().length) {
        <p class="grp">{{ i18n.t('site.yourOrders') }}</p>
        <ul class="list">
          @for (s of assigned(); track s.id) {
            <li><ng-container *ngTemplateOutlet="row; context: { $implicit: s }" /></li>
          }
        </ul>
      }
      @if (others().length) {
        <p class="grp">{{ i18n.t(assigned().length ? 'site.otherSites' : 'site.allSites') }}</p>
        <ul class="list">
          @for (s of others(); track s.id) {
            <li><ng-container *ngTemplateOutlet="row; context: { $implicit: s }" /></li>
          }
        </ul>
      }
      @if (!assigned().length && !others().length) {
        <p class="px-5 py-4 text-[var(--color-text-muted)]">{{ i18n.t('site.noMatch') }}</p>
      }

      <div class="px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3">
        <button type="button" class="act act-line w-full" (click)="store.resolveSite(undefined)">{{ i18n.t('common.cancel') }}</button>
      </div>
    </dialog>

    <ng-template #row let-s>
      <button type="button" class="site" (click)="store.resolveSite(s.id)">
        <aon-icon name="pin" [size]="20" class="shrink-0 text-[var(--color-gold-ink)]" />
        <span class="min-w-0 flex-1">
          <span class="block font-semibold leading-tight">{{ s.label }}</span>
          @if (s.city) {
            <span class="block text-[0.9rem] text-[var(--color-text-muted)]">{{ s.city }}</span>
          }
        </span>
        <aon-icon name="play" [size]="18" [stroke]="2.4" class="shrink-0" />
      </button>
    </ng-template>
  `,
  styles: `
    .sheet {
      border-radius: 1rem 1rem 0 0;
      font-family: var(--font-ui);
    }
    @media (min-width: 640px) {
      .sheet {
        border-radius: 1rem;
      }
    }
    .badge {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 9999px;
      background: var(--color-gold-fill);
      color: var(--color-gold-ink);
    }
    .grp {
      margin: 1rem 1.25rem 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .list {
      margin: 0 1.25rem;
      border-top: 1px solid var(--color-line);
    }
    .list > li {
      border-bottom: 1px solid var(--color-line);
    }
    .site {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      width: 100%;
      min-height: 3.75rem;
      padding: 0.6rem 0.25rem;
      text-align: left;
    }
    .site:hover,
    .site:focus-visible {
      background: var(--color-field);
    }
    .act {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 3.5rem;
      border-radius: 0.6rem;
      font-weight: 600;
    }
    .act-line {
      border: 1px solid var(--color-line-strong);
      background: #fff;
    }
  `,
})
export class SitePickerComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(WorkerStore);
  protected readonly query = signal('');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  private readonly filtered = computed<readonly SiteOption[]>(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const all = this.store.siteOptions();
    return q ? all.filter((s) => `${s.label} ${s.city}`.toLocaleLowerCase().includes(q)) : all;
  });
  protected readonly assigned = computed(() => this.filtered().filter((s) => s.assigned));
  protected readonly others = computed(() => this.filtered().filter((s) => !s.assigned));

  constructor() {
    afterNextRender(() => {
      const el = this.dialog().nativeElement;
      try {
        el.showModal();
      } catch {
        el.setAttribute('open', '');
      }
    });
  }
}
