import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { SummaryDetailResponse } from '../../core/models/api.models';
import type { PhotoCategory, QuantityUnit } from '../../core/models/domain.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDuration } from '../../core/util/util';
import { IconComponent } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { ManagerStore } from './data/manager-store.service';

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: SummaryDetailResponse };

/**
 * One worker's daily report, read like the signed paper it replaces, with the manager's decision at
 * its foot. Returning it requires a note, so the worker always knows what to fix.
 */
@Component({
  selector: 'aon-report-review',
  imports: [IconComponent, ReportStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-charcoal bg-stock px-5 py-3">
      <h2 id="drill-title" class="min-w-0 truncate font-cond text-2xl">{{ i18n.t('review.title', { name: detail()?.worker?.displayName ?? '' }) }}</h2>
      <button type="button" class="-mr-2 grid size-12 shrink-0 place-items-center hover:bg-ground" [attr.aria-label]="i18n.t('common.close')" (click)="closed.emit()">
        <aon-icon name="x" [size]="24" [stroke]="2.5" />
      </button>
    </div>

    @switch (state().kind) {
      @case ('LOADING') {
        <div class="grid gap-3 p-5" aria-busy="true">
          <div class="h-24 animate-pulse bg-ground-deep"></div>
          <div class="h-40 animate-pulse bg-ground-deep"></div>
          <span class="sr-only">{{ i18n.t('common.loading') }}</span>
        </div>
      }
      @case ('ERROR') {
        <div class="p-5">
          <p class="flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
            <aon-icon name="alert" [size]="20" />{{ i18n.t('review.loadFailed') }}
          </p>
          <button type="button" class="mt-3 flex min-h-12 items-center gap-2 bg-charcoal px-4 font-cond text-lg text-white" (click)="reload()">
            <aon-icon name="retry" [size]="18" />{{ i18n.t('common.retry') }}
          </button>
        </div>
      }
      @case ('READY') {
        @if (detail(); as d) {
          @let s = d.summary;
          <div class="grid gap-6 p-5 pb-8">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-semibold">{{ i18n.dateLong(s.date) }}<span class="text-ink-muted"> · {{ d.worker.crew }}</span></p>
              <aon-report-status [status]="s.status" />
            </div>

            <dl class="grid grid-cols-3 border-2 border-charcoal bg-stock">
              <div class="border-r-2 border-charcoal px-3 py-2.5">
                <dt class="label-caps text-ink-muted">{{ i18n.t('day.arrival') }}</dt>
                <dd class="font-cond-tight text-[1.75rem] leading-none">{{ i18n.time(s.arrivalAt) }}</dd>
              </div>
              <div class="border-r-2 border-charcoal px-3 py-2.5">
                <dt class="label-caps text-ink-muted">{{ i18n.t('day.departure') }}</dt>
                <dd class="font-cond-tight text-[1.75rem] leading-none">{{ i18n.time(s.departureAt) }}</dd>
              </div>
              <div class="bg-charcoal px-3 py-2.5 text-white">
                <dt class="label-caps text-on-dark-muted">{{ i18n.t('day.hours') }}</dt>
                <dd class="font-cond-tight text-[1.75rem] leading-none">{{ duration(s.shiftMinutes) }}</dd>
              </div>
            </dl>

            @if (s.declaredEnd || s.corrections.length) {
              <section class="grid gap-2" aria-labelledby="rv-corr">
                <h3 id="rv-corr" class="flex items-center gap-2 font-cond text-xl"><aon-icon name="clock" [size]="20" />{{ i18n.t('review.timeFlags') }}</h3>
                @if (s.declaredEnd) {
                  <p class="border-2 border-dashed border-hold bg-stock px-4 py-2.5 font-semibold text-hold-ink">{{ i18n.t('review.declaredEnd') }}</p>
                }
                @for (c of s.corrections; track $index) {
                  <div class="border-2 border-dashed border-charcoal bg-gold-pale px-4 py-2.5">
                    <p class="font-bold">
                      {{ i18n.t(c.field === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}:
                      <span class="font-cond text-lg">{{ i18n.time(c.recordedAt) }} → {{ i18n.time(c.proposedAt) }}</span>
                    </p>
                    <p class="text-[0.95rem]">{{ c.reason }}</p>
                  </div>
                }
                <p class="text-sm font-semibold text-ink-muted">{{ i18n.t('review.correctionNote') }}</p>
              </section>
            }

            <section aria-labelledby="rv-lines">
              <div class="flex items-baseline justify-between border-b-2 border-charcoal pb-1">
                <h3 id="rv-lines" class="font-cond text-xl">{{ i18n.t('day.ordersWorked') }}</h3>
                <span class="font-cond text-lg">{{ i18n.t('day.onOrdersTotal', { duration: duration(s.orderMinutes) }) }}</span>
              </div>
              @for (l of s.lines; track l.workOrderId) {
                <article class="mt-3 border-2 border-charcoal bg-stock">
                  <div class="flex items-start justify-between gap-3 border-b-2 border-charcoal px-4 py-2">
                    <p class="min-w-0">
                      <span class="font-cond-tight text-xl">{{ l.code }}</span>
                      <span class="block truncate font-semibold">{{ l.title }}</span>
                      <span class="block truncate text-sm text-ink-muted">{{ l.siteName }}</span>
                    </p>
                    <p class="shrink-0 text-right">
                      <span class="block font-cond-tight text-2xl leading-none">{{ duration(l.minutes) }}</span>
                      <span class="block font-cond text-lg">{{ i18n.number(l.quantity) }} {{ i18n.t(unitKey(l.unit)) }}</span>
                    </p>
                  </div>
                  <div class="grid gap-2 px-4 py-3">
                    @for (issue of l.issues; track $index) {
                      <p class="flex items-start gap-2 bg-hold-pale px-3 py-1.5 text-[0.95rem] font-semibold text-hold-ink"><aon-icon name="alert" [size]="16" class="mt-0.5" />{{ issue }}</p>
                    }
                    <p class="label-caps text-ink-muted">{{ i18n.t('day.workDone') }}</p>
                    <p class="whitespace-pre-line leading-snug">{{ l.workDone || i18n.t('common.none') }}</p>
                    @if (l.materialsUsed.length) {
                      <p class="mt-1 label-caps text-ink-muted">{{ i18n.t('day.materialsUsed') }}</p>
                      <ul>
                        @for (m of l.materialsUsed; track $index) {
                          <li class="flex justify-between gap-3 border-b border-rule-soft py-1 text-[0.95rem]">
                            <span class="font-semibold">{{ m.name }}</span><span class="font-cond text-base">{{ m.qty !== null ? i18n.number(m.qty) : '' }} {{ m.unit ?? '' }}</span>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                </article>
              } @empty {
                <p class="mt-2 text-ink-muted">{{ i18n.t('day.noOrders') }}</p>
              }
            </section>

            <section aria-labelledby="rv-comment">
              <h3 id="rv-comment" class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('reports.comment') }}</h3>
              <p class="mt-2 whitespace-pre-line leading-snug">{{ s.comment || i18n.t('common.none') }}</p>
            </section>

            <section aria-labelledby="rv-photos">
              <h3 id="rv-photos" class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('day.photos') }} · {{ d.photos.length }}</h3>
              @if (d.photos.length) {
                <ul class="mt-2 grid grid-cols-3 gap-2">
                  @for (p of d.photos; track p.id) {
                    <li class="bg-charcoal">
                      @if (p.url) {
                        <img [src]="p.url" [alt]="i18n.t('photo.alt', { category: i18n.t(photoKey(p.category)), code: '' })" class="aspect-square w-full object-cover" loading="lazy" />
                      }
                      <p class="px-1.5 py-1 text-[0.7rem] font-extrabold uppercase tracking-wide text-white">{{ i18n.t(photoKey(p.category)) }} · {{ i18n.time(p.createdAt) }}</p>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mt-2 text-ink-muted">{{ i18n.t('photo.none') }}</p>
              }
            </section>

            @if (s.status === 'SUBMITTED') {
              <section class="border-t-[3px] border-charcoal pt-4" aria-labelledby="rv-decide">
                <h3 id="rv-decide" class="font-cond text-2xl">{{ i18n.t('review.decide') }}</h3>
                @if (!network.online()) {
                  <p class="mt-2 flex items-start gap-2 font-semibold text-hold-ink"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('review.needsNetwork') }}</p>
                }
                <label class="mt-3 block">
                  <span class="label-caps text-ink-muted">{{ i18n.t('review.noteLabel') }}</span>
                  <textarea
                    rows="3"
                    maxlength="1000"
                    class="mt-1 block w-full border-2 bg-white px-3 py-2 leading-snug outline-none placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
                    [class]="noteMissing() ? 'border-hold' : 'border-charcoal'"
                    [placeholder]="i18n.t('reports.notePlaceholder')"
                    [value]="note()"
                    (input)="note.set($any($event.target).value); noteMissing.set(false)"
                  ></textarea>
                  @if (noteMissing()) {
                    <span class="mt-1 block text-sm font-bold text-hold-ink" role="alert">{{ i18n.t('review.noteRequired') }}</span>
                  }
                </label>
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" class="flex min-h-14 items-center justify-center gap-2 bg-done font-cond text-xl text-white disabled:opacity-50" [disabled]="busy() || !network.online()" (click)="decide('APPROVED')">
                    <aon-icon name="check" [size]="22" [stroke]="3" />{{ i18n.t('reports.approve') }}
                  </button>
                  <button type="button" class="flex min-h-14 items-center justify-center gap-2 bg-stock font-cond text-xl text-hold-ink ring-2 ring-inset ring-hold disabled:opacity-50" [disabled]="busy() || !network.online()" (click)="decide('RETURNED')">
                    <aon-icon name="retry" [size]="20" />{{ i18n.t('reports.return') }}
                  </button>
                </div>
              </section>
            } @else if (s.reviewedAt) {
              <p class="flex items-center gap-2 border-t-[3px] border-charcoal pt-4 font-semibold">
                <aon-icon [name]="s.status === 'APPROVED' ? 'circle-check' : 'retry'" [size]="20" [class]="s.status === 'APPROVED' ? 'text-done' : 'text-hold'" />
                {{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.time(s.reviewedAt) }) }}
                @if (s.reviewerNote) {
                  <span class="text-ink-muted">· »{{ s.reviewerNote }}«</span>
                }
              </p>
            }
          </div>
        }
      }
    }
  `,
})
export class ReportReviewComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly network = inject(NetworkStatusService);
  private readonly store = inject(ManagerStore);
  private readonly toast = inject(ToastService);

  readonly summaryId = input.required<string>();
  readonly closed = output<void>();

  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly note = signal('');
  protected readonly noteMissing = signal(false);
  protected readonly busy = signal(false);
  private seq = 0;

  protected readonly detail = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });

  constructor() {
    // Track only the id: fetch() reads `state`, which would otherwise re-run this effect after every load.
    effect(() => {
      const id = this.summaryId();
      untracked(() => void this.fetch(id));
    });
  }

  protected duration(minutes: number): string {
    return formatDuration(minutes);
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected photoKey(c: PhotoCategory): `photoCat.${PhotoCategory}` {
    return `photoCat.${c}`;
  }

  protected reload(): void {
    void this.fetch(this.summaryId());
  }

  protected async decide(decision: 'APPROVED' | 'RETURNED'): Promise<void> {
    const note = this.note().trim();
    if (decision === 'RETURNED' && !note) {
      this.noteMissing.set(true);
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.store.review(this.summaryId(), { decision, note: note || null });
      this.toast.success(this.i18n.t(decision === 'APPROVED' ? 'reports.approvedToast' : 'reports.returnedToast'));
      this.note.set('');
      await this.fetch(this.summaryId());
    } catch (err: unknown) {
      console.warn('[AON] review failed', err);
      this.toast.error(this.i18n.t('reports.reviewFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  private async fetch(id: string): Promise<void> {
    const seq = ++this.seq;
    if (this.detail()?.summary.id !== id) this.state.set({ kind: 'LOADING' });
    try {
      const data = await this.store.summaryDetail(id);
      if (seq === this.seq) this.state.set({ kind: 'READY', data });
    } catch (err: unknown) {
      console.warn('[AON] report detail failed', err);
      if (seq === this.seq) this.state.set({ kind: 'ERROR' });
    }
  }
}
