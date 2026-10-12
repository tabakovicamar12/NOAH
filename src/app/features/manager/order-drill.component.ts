import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { WorkOrderDetailResponse } from '../../core/models/api.models';
import { PHOTO_CATEGORIES, type PhotoCategory, type WorkOrderStatus } from '../../core/models/domain.models';
import { ClockService } from '../../core/ui/clock.service';
import { formatDuration, minutesBetween } from '../../core/util/util';
import { RouterLink } from '@angular/router';
import { hoursLabel } from '../../shared/ui/format';
import { IconComponent } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { TAG_FILL, progressRatio } from '../../shared/ui/tag-style';
import { ManagerStore } from './data/manager-store.service';

type DrillState = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: WorkOrderDetailResponse };

/** Side drill-down for one work order. Sits beside the table so the day's context stays visible. */
@Component({
  selector: 'aon-order-drill',
  imports: [IconComponent, RouterLink, ReportStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="flex items-center justify-between gap-3 border-b-2 border-charcoal bg-stock px-5 py-3">
      <h2 id="drill-title" class="font-cond text-2xl">{{ i18n.t('drill.title', { code: code() }) }}</h2>
      <button
        type="button"
        class="-mr-2 grid size-12 place-items-center hover:bg-ground"
        [attr.aria-label]="i18n.t('common.close')"
        (click)="closed.emit()"
      >
        <aon-icon name="x" [size]="24" [stroke]="2.5" />
      </button>
    </div>

    @switch (state().kind) {
      @case ('LOADING') {
        <div class="grid gap-3 p-5" aria-busy="true">
          <div class="h-32 animate-pulse bg-ground-deep"></div>
          <div class="h-5 w-2/3 animate-pulse bg-ground-deep"></div>
          <div class="h-24 animate-pulse bg-ground-deep"></div>
          <span class="sr-only">{{ i18n.t('common.loading') }}</span>
        </div>
      }
      @case ('ERROR') {
        <div class="p-5">
          <p class="flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
            <aon-icon name="alert" [size]="20" />{{ i18n.t('drill.loadFailed') }}
          </p>
          <button type="button" class="mt-3 flex min-h-12 items-center gap-2 bg-charcoal px-4 font-cond text-lg text-white" (click)="reload()">
            <aon-icon name="retry" [size]="18" />{{ i18n.t('common.retry') }}
          </button>
        </div>
      }
      @case ('READY') {
        @if (detail(); as d) {
          @let fill = TAG_FILL[d.order.status];
          <div class="grid gap-6 p-5">
            <section class="tag-shape py-4 pr-4" [class]="fill.cls">
              <span class="tag-eyelet"></span>
              <div class="flex items-start justify-between gap-3">
                <p class="font-cond-tight text-4xl leading-none">{{ d.order.code }}</p>
                <span class="flex items-center gap-1.5 label-caps" [class]="fill.muted">
                  <aon-icon [name]="fill.icon" [size]="14" [stroke]="3" />{{ i18n.t(statusKey(d.order.status)) }}
                </span>
              </div>
              <p class="mt-1 text-lg font-bold leading-snug">{{ d.order.title }}</p>
              <p class="text-[0.95rem] font-semibold" [class]="fill.muted">{{ d.order.location }}</p>
              <div class="mt-3 h-3 border-2 border-current bg-white/30" aria-hidden="true">
                <div class="h-full bg-current" [style.width.%]="progressRatio(d.order.doneQty, d.order.plannedQty) * 100"></div>
              </div>
              <p class="mt-1 font-cond text-lg">
                {{ i18n.t('order.progress', { done: i18n.number(d.order.doneQty), planned: i18n.number(d.order.plannedQty), unit: i18n.t(unitKey()) }) }}
              </p>
            </section>

            <div class="grid grid-cols-2 gap-2">
              <a
                [routerLink]="['/m/orders', d.order.id, 'edit']"
                class="flex min-h-12 items-center justify-center gap-2 bg-charcoal font-cond text-lg text-white no-underline"
              >
                <aon-icon name="pencil" [size]="18" />{{ i18n.t('drill.edit') }}
              </a>
              <a
                routerLink="/m/orders/new"
                [queryParams]="{ from: d.order.id }"
                class="flex min-h-12 items-center justify-center gap-2 bg-stock font-cond text-lg text-ink no-underline ring-2 ring-inset ring-charcoal"
              >
                <aon-icon name="copy" [size]="18" />{{ i18n.t('drill.duplicate') }}
              </a>
            </div>

            @if (!d.order.published) {
              <p class="flex items-start gap-2 border-2 border-dashed border-charcoal bg-stock px-4 py-3 font-semibold">
                <aon-icon name="note" [size]="20" />{{ i18n.t('drill.draftNote') }}
              </p>
            }

            <dl class="grid grid-cols-2 border-2 border-charcoal bg-stock">
              <div class="col-span-2 border-b-2 border-charcoal px-4 py-3">
                <dt class="label-caps text-ink-muted">{{ i18n.t('drill.crew') }}</dt>
                <dd class="mt-0.5 font-semibold">
                  @for (c of d.order.crew; track c.id; let last = $last) {
                    <span class="whitespace-nowrap">{{ c.displayName }}@if (locked().has(c.id)) {<aon-icon name="lock" [size]="13" class="ml-0.5 align-[-1px] text-ink-muted" />}</span>@if (!last) {<span>, </span>}
                  } @empty {
                    <span class="text-ink-muted">{{ i18n.t('mgr.unassigned') }}</span>
                  }
                </dd>
              </div>
              <div class="border-r-2 border-charcoal px-4 py-3">
                <dt class="label-caps text-ink-muted">{{ i18n.t('drill.site') }}</dt>
                <dd class="mt-0.5 font-semibold">{{ d.order.siteName }}</dd>
              </div>
              <div class="px-4 py-3">
                <dt class="label-caps text-ink-muted">{{ i18n.t('order.estimate') }}</dt>
                <dd class="mt-0.5 font-semibold">
                  {{ d.order.estimatedMinutes ? estimate(d.order.estimatedMinutes) : i18n.t('common.none') }}
                  @if (d.order.dueDate) {
                    <span class="block text-sm font-normal text-ink-muted">{{ i18n.t('orders.due', { date: i18n.date(d.order.dueDate) }) }}</span>
                  }
                </dd>
              </div>
            </dl>

            <section aria-labelledby="drill-reports">
              <h3 id="drill-reports" class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('drill.summaries') }}</h3>
              @if (d.summaries.length === 0) {
                <p class="mt-2 text-ink-muted">{{ i18n.t('drill.noSummaries') }}</p>
              } @else {
                <ul class="mt-1">
                  @for (s of d.summaries; track s.id) {
                    <li>
                      <button
                        type="button"
                        class="flex min-h-14 w-full items-center justify-between gap-3 border-b border-rule-soft py-2 text-left hover:bg-stock"
                        (click)="openReport.emit(s.id)"
                      >
                        <span class="min-w-0">
                          <span class="block truncate font-semibold">{{ workerName(s.userId) }}</span>
                          <span class="block text-sm text-ink-muted">{{ i18n.date(s.date) }} · {{ duration(s.shiftMinutes) }}</span>
                        </span>
                        <span class="flex shrink-0 items-center gap-2">
                          <aon-report-status [status]="s.status" />
                          <aon-icon name="chevron-right" [size]="20" />
                        </span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </section>

            <section aria-labelledby="drill-time">
              <div class="flex items-baseline justify-between border-b-2 border-charcoal pb-1">
                <h3 id="drill-time" class="font-cond text-xl">{{ i18n.t('drill.timeLogged') }}</h3>
                <span class="font-cond text-xl">{{ i18n.t('drill.timeTotal', { duration: totalTime() }) }}</span>
              </div>
              @if (segments().length === 0) {
                <p class="mt-2 text-ink-muted">{{ i18n.t('drill.noTime') }}</p>
              } @else {
                <ol class="mt-1">
                  @for (s of segments(); track s.id) {
                    <li class="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 text-[0.95rem]">
                      <span>
                        <span class="font-semibold">{{ workerName(s.userId) }}</span>
                        <span class="text-ink-muted"> · {{ i18n.date(s.date) }} · {{ i18n.time(s.startedAt) }}–{{ s.endedAt ? i18n.time(s.endedAt) : i18n.t('drill.running') }}</span>
                        @if (s.endSource === 'DECLARED') {
                          <span class="block text-sm font-semibold text-hold-ink">{{ i18n.t('drill.declared') }}</span>
                        }
                      </span>
                      <span class="font-cond text-lg" [class.text-gold-ink]="!s.endedAt">{{ s.duration }}</span>
                    </li>
                  }
                </ol>
              }
            </section>

            <section aria-labelledby="drill-issues">
              <h3 id="drill-issues" class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('drill.issues') }}</h3>
              @if (issues().length === 0) {
                <p class="mt-2 text-ink-muted">{{ i18n.t('drill.noIssues') }}</p>
              } @else {
                <ul class="mt-2 grid gap-2">
                  @for (l of issues(); track l.id) {
                    <li class="border-2 border-hold bg-hold-pale px-4 py-3">
                      <p class="flex items-center gap-1.5 label-caps text-hold-ink"><aon-icon name="alert" [size]="14" [stroke]="3" />{{ workerName(l.userId) }} · {{ i18n.time(l.createdAt) }} · {{ i18n.date(l.createdAt) }}</p>
                      <p class="mt-1 font-semibold leading-snug">{{ l.text }}</p>
                    </li>
                  }
                </ul>
              }
            </section>

            <section aria-labelledby="drill-photos">
              <h3 id="drill-photos" class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('drill.photos') }}</h3>
              @if (d.photos.length === 0) {
                <p class="mt-2 text-ink-muted">{{ i18n.t('photo.none') }}</p>
              } @else {
                <ul class="mt-2 grid grid-cols-2 gap-2">
                  @for (p of d.photos; track p.id) {
                    <li class="border-2 bg-stock" [class]="p.category === 'ISSUE' ? 'border-hold' : 'border-charcoal'">
                      @if (p.url) {
                        <a [href]="p.url" target="_blank" rel="noopener" class="block">
                          <img [src]="p.url" [alt]="i18n.t('photo.alt', { category: i18n.t(photoKey(p.category)), code: d.order.code ?? '' })" class="aspect-[4/3] w-full object-cover" loading="lazy" />
                        </a>
                      } @else {
                        <div class="grid aspect-[4/3] place-items-center bg-ground-deep px-3 text-center">
                          <aon-icon name="image-off" [size]="26" class="text-ink-muted" />
                        </div>
                      }
                      <div class="px-2 py-1.5">
                        <p class="flex items-center justify-between gap-2 label-caps" [class.text-hold-ink]="p.category === 'ISSUE'">
                          {{ i18n.t(photoKey(p.category)) }}<span class="text-ink-muted">{{ i18n.time(p.createdAt) }}</span>
                        </p>
                        <p class="truncate text-sm text-ink-muted">{{ p.userName }} · {{ i18n.date(p.createdAt) }}</p>
                        @if (p.caption) {
                          <p class="mt-0.5 text-sm font-semibold leading-snug">{{ p.caption }}</p>
                        }
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>

            <section aria-labelledby="drill-notes">
              <h3 id="drill-notes" class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('drill.notes') }}</h3>
              @if (notes().length === 0) {
                <p class="mt-2 text-ink-muted">{{ i18n.t('drill.noNotes') }}</p>
              } @else {
                <ol class="mt-1">
                  @for (l of notes(); track l.id) {
                    <li class="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-rule-soft py-2 text-[0.95rem]">
                      <span class="font-cond text-lg leading-tight">
                        @if (l.kind === 'QUANTITY') {
                          {{ i18n.t('order.logQuantity', { q: i18n.number(l.quantity ?? 0), unit: i18n.t(unitKey()) }) }}
                        } @else {
                          <aon-icon name="note" [size]="18" />
                        }
                      </span>
                      <span>
                        <span class="block text-ink-muted">{{ workerName(l.userId) }} · {{ i18n.date(l.createdAt) }} · {{ i18n.time(l.createdAt) }}</span>
                        @if (l.text) {
                          <span class="block font-semibold leading-snug">{{ l.text }}</span>
                        }
                      </span>
                    </li>
                  }
                </ol>
              }
            </section>
          </div>
        }
      }
    }
  `,
})
export class OrderDrillComponent {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(ManagerStore);
  private readonly clock = inject(ClockService);

  readonly orderId = input.required<string>();
  readonly code = input<string>('');
  readonly closed = output<void>();
  readonly openReport = output<string>();

  protected readonly locked = computed(() => new Set(this.detail()?.lockedCrewIds ?? []));
  private readonly names = computed(() => {
    const map = new Map<string, string>();
    for (const w of this.store.overview()?.workers ?? []) map.set(w.user.id, w.user.displayName);
    for (const c of this.detail()?.order.crew ?? []) map.set(c.id, c.displayName);
    return map;
  });

  protected workerName(userId: string): string {
    return this.names().get(userId) ?? userId;
  }

  protected duration(minutes: number): string {
    return formatDuration(minutes);
  }

  protected estimate(minutes: number): string {
    return hoursLabel(this.i18n, minutes);
  }

  protected readonly TAG_FILL = TAG_FILL;
  protected readonly progressRatio = progressRatio;
  protected readonly state = signal<DrillState>({ kind: 'LOADING' });
  private seq = 0;

  protected readonly detail = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });

  protected readonly segments = computed(() => {
    const now = this.clock.now();
    return (this.detail()?.timeEntries ?? [])
      .filter((e) => e.kind === 'ORDER')
      .map((e) => ({ ...e, duration: formatDuration(minutesBetween(e.startedAt, e.endedAt ?? now)) }));
  });
  protected readonly totalTime = computed(() => {
    const now = this.clock.now();
    const total = (this.detail()?.timeEntries ?? [])
      .filter((e) => e.kind === 'ORDER')
      .reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? now), 0);
    return formatDuration(total);
  });
  protected readonly issues = computed(() => (this.detail()?.logs ?? []).filter((l) => l.kind === 'ISSUE'));
  protected readonly notes = computed(() => (this.detail()?.logs ?? []).filter((l) => l.kind !== 'ISSUE'));
  protected readonly unitKey = computed(() => `unit.${this.detail()?.order.unit ?? 'PCS'}` as const);

  constructor() {
    effect(() => {
      const id = this.orderId();
      void this.fetch(id);
    });
  }

  protected statusKey(status: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${status}`;
  }

  protected photoKey(category: PhotoCategory): `photoCat.${PhotoCategory}` {
    return PHOTO_CATEGORIES.includes(category) ? `photoCat.${category}` : 'photoCat.IN_PROGRESS';
  }

  protected reload(): void {
    void this.fetch(this.orderId());
  }

  private async fetch(id: string): Promise<void> {
    const seq = ++this.seq;
    this.state.set({ kind: 'LOADING' });
    try {
      const data = await this.store.detail(id);
      if (seq === this.seq) this.state.set({ kind: 'READY', data });
    } catch (err: unknown) {
      console.warn('[AON] order detail failed', err);
      if (seq === this.seq) this.state.set({ kind: 'ERROR' });
    }
  }
}
