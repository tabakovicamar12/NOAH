import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { LogEntry, WorkOrder, WorkOrderStatus } from '../../core/models/domain.models';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { formatDuration, isIsoDate, minutesToHours } from '../../core/util/util';
import { IconComponent } from '../../shared/ui/icon.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { StatusTagComponent } from '../../shared/ui/status-tag.component';
import { ManagerStore } from './data/manager-store.service';

interface IssueLine {
  readonly code: string;
  readonly title: string;
  readonly assignee: string | null;
  readonly logs: readonly LogEntry[];
}

const STATUS_RANK: Readonly<Record<WorkOrderStatus, number>> = { ISSUE: 0, IN_PROGRESS: 1, NEW: 2, COMPLETED: 3 };

/**
 * Daily report as an A4 sheet. Export is the browser's own print-to-PDF: works offline,
 * keeps the real typeface and Slovenian diacritics, and needs no PDF library in the bundle.
 */
@Component({
  selector: 'aon-manager-report',
  imports: [RouterLink, IconComponent, LogoComponent, StatusTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b-2 border-charcoal bg-ground px-4 py-3 sm:px-6 lg:px-8">
      <div class="flex items-center gap-3">
        <a routerLink="/m" class="grid size-12 place-items-center border-2 border-charcoal bg-stock text-ink" [attr.aria-label]="i18n.t('common.back')">
          <aon-icon name="arrow-left" [size]="22" [stroke]="2.5" />
        </a>
        <div>
          <h1 class="font-cond text-2xl leading-none">{{ i18n.t('pdf.preview') }}</h1>
          <p class="mt-1 text-sm text-ink-muted">{{ i18n.t('pdf.hint') }}</p>
        </div>
      </div>
      <button
        type="button"
        class="flex min-h-12 items-center gap-2 bg-gold px-5 font-cond text-lg text-ink hover:brightness-95 disabled:opacity-50"
        [disabled]="!data()"
        (click)="print()"
      >
        <aon-icon name="printer" [size]="20" />{{ i18n.t('pdf.print') }}
      </button>
    </div>

    <div class="px-4 py-6 sm:px-6 lg:px-8 print:p-0">
      @if (store.state() === 'CACHED') {
        <p class="no-print mx-auto mb-4 flex max-w-[210mm] items-center gap-2 border-2 border-dashed border-charcoal bg-stock px-4 py-3 font-semibold">
          <aon-icon name="cloud-off" [size]="20" class="text-hold" />{{ i18n.t('mgr.offlineCached', { time: cachedAt() }) }}
        </p>
      }

      @if (data(); as d) {
        <article class="sheet mx-auto max-w-[210mm] bg-white px-[12mm] py-[12mm] text-ink shadow-[0_18px_40px_-20px_rgb(0_0_0/0.45)] print:max-w-none print:p-0 print:shadow-none">
          <header class="flex items-start justify-between gap-6 border-b-[3px] border-charcoal pb-4">
            <aon-logo [size]="2" [sub]="i18n.t('app.company')" />
            <div class="text-right">
              <p class="font-cond-tight text-3xl leading-none">{{ i18n.t('pdf.title') }}</p>
              <p class="mt-1 font-semibold">{{ i18n.dateLong(d.date) }}</p>
              <p class="text-sm text-ink-muted">{{ i18n.t('pdf.generated', { time: generated() }) }}</p>
            </div>
          </header>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p class="font-semibold">{{ i18n.t('pdf.totals', { h: i18n.number(totals().hours), p: totals().inProgress, c: totals().completed }) }}</p>
            @if (demo) {
              <span class="border-2 border-dashed border-charcoal px-2 py-0.5 label-caps">{{ i18n.t('common.demo') }}</span>
            }
          </div>

          <section class="mt-6 break-inside-avoid-page">
            <h2 class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('pdf.workers') }}</h2>
            <table class="mt-1 w-full border-collapse text-left text-[0.85rem]">
              <thead>
                <tr class="border-b border-charcoal">
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colWorker') }}</th>
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colSite') }}</th>
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colPresence') }}</th>
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colSince') }}</th>
                  <th scope="col" class="py-1.5 pr-2 text-right label-caps text-[0.7rem]">{{ i18n.t('mgr.colHours') }}</th>
                  <th scope="col" class="py-1.5 label-caps text-[0.7rem]">{{ i18n.t('mgr.colSummary') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (w of workers(); track w.user.id) {
                  <tr class="border-b border-rule-soft">
                    <td class="py-1.5 pr-2 font-semibold">{{ w.user.displayName }} <span class="font-normal text-ink-muted">· {{ w.user.crew }}</span></td>
                    <td class="py-1.5 pr-2">{{ w.site?.projectName ?? i18n.t('common.none') }}</td>
                    <td class="py-1.5 pr-2">{{ i18n.t(presenceKey(w.presence)) }}</td>
                    <td class="py-1.5 pr-2">{{ w.shiftStartedAt ? i18n.time(w.shiftStartedAt) : i18n.t('common.none') }}</td>
                    <td class="py-1.5 pr-2 text-right font-cond text-base">{{ w.minutesToday ? formatDuration(w.minutesToday) : i18n.t('common.none') }}</td>
                    <td class="py-1.5">{{ w.summaryStatus ? i18n.t(summaryKey(w.summaryStatus)) : i18n.t('common.none') }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>

          <section class="mt-6">
            <h2 class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('pdf.orders') }}</h2>
            <table class="mt-1 w-full border-collapse text-left text-[0.85rem]">
              <thead>
                <tr class="border-b border-charcoal">
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colStatus') }}</th>
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colCode') }}</th>
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colTitle') }}</th>
                  <th scope="col" class="py-1.5 pr-2 label-caps text-[0.7rem]">{{ i18n.t('mgr.colCrew') }}</th>
                  <th scope="col" class="py-1.5 pr-2 text-right label-caps text-[0.7rem]">{{ i18n.t('mgr.colToday') }}</th>
                  <th scope="col" class="py-1.5 text-right label-caps text-[0.7rem]">{{ i18n.t('mgr.colProgress') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (r of orders(); track r.order.id) {
                  <tr class="break-inside-avoid border-b border-rule-soft">
                    <td class="py-1.5 pr-2"><aon-status-tag [status]="r.order.status" size="sm" /></td>
                    <td class="py-1.5 pr-2 font-cond-tight text-base">{{ r.order.code }}</td>
                    <td class="py-1.5 pr-2">{{ r.order.title }}</td>
                    <td class="py-1.5 pr-2">{{ crewNames(r.order.crew) }}</td>
                    <td class="py-1.5 pr-2 text-right font-cond text-base">{{ r.minutesToday ? formatDuration(r.minutesToday) : i18n.t('common.none') }}</td>
                    <td class="py-1.5 text-right font-cond text-base">{{ i18n.number(r.order.doneQty) }} / {{ i18n.number(r.order.plannedQty) }} {{ i18n.t(unitKey(r.order.unit)) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>

          <section class="mt-6 break-inside-avoid-page">
            <h2 class="border-b-2 border-charcoal pb-1 font-cond text-xl">{{ i18n.t('pdf.issues') }}</h2>
            @if (issuesLoading()) {
              <p class="mt-2 text-ink-muted">{{ i18n.t('pdf.loadIssues') }}</p>
            } @else if (issues().length === 0) {
              <p class="mt-2 text-ink-muted">{{ i18n.t('drill.noIssues') }}</p>
            } @else {
              <ul class="mt-2 grid gap-2">
                @for (i of issues(); track i.code) {
                  <li class="break-inside-avoid border-2 border-hold px-3 py-2">
                    <p class="font-bold"><span class="font-cond-tight text-base">{{ i.code }}</span> · {{ i.title }} <span class="font-normal text-ink-muted">· {{ i.assignee ?? i18n.t('mgr.unassigned') }}</span></p>
                    @for (l of i.logs; track l.id) {
                      <p class="mt-0.5 text-[0.85rem]"><span class="font-semibold">{{ i18n.time(l.createdAt) }}</span> {{ l.text }}</p>
                    } @empty {
                      <p class="mt-0.5 text-[0.85rem] text-ink-muted">{{ i18n.t('common.none') }}</p>
                    }
                  </li>
                }
              </ul>
            }
          </section>

          <section class="mt-14 grid grid-cols-2 gap-10 break-inside-avoid">
            <div>
              <div class="h-12 border-b-2 border-charcoal"></div>
              <p class="mt-1 label-caps text-[0.7rem] text-ink-muted">{{ i18n.t('pdf.signature') }}</p>
            </div>
            <div>
              <div class="h-12 border-b-2 border-charcoal"></div>
              <p class="mt-1 label-caps text-[0.7rem] text-ink-muted">{{ i18n.t('mgr.date') }}</p>
            </div>
          </section>

          <footer class="mt-8 border-t border-charcoal pt-2 text-[0.75rem] font-semibold text-ink-muted">{{ i18n.t('pdf.page', { date: i18n.date(d.date) }) }}</footer>
        </article>
      } @else if (store.state() === 'LOADING') {
        <div class="mx-auto h-[60vh] max-w-[210mm] animate-pulse bg-ground-deep" aria-busy="true"><span class="sr-only">{{ i18n.t('common.loading') }}</span></div>
      } @else {
        <p class="mx-auto flex max-w-[210mm] items-center gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
          <aon-icon name="alert" [size]="20" />{{ store.state() === 'EMPTY_OFFLINE' ? i18n.t('mgr.offlineNoCache') : i18n.t('mgr.loadFailed') }}
        </p>
      }
    </div>
  `,
  styles: `
    .sheet {
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
  `,
})
export class ReportComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ManagerStore);
  private readonly document = inject(DOCUMENT);

  /** `?date=YYYY-MM-DD`, bound by withComponentInputBinding. */
  readonly date = input<string | undefined>(undefined);

  protected readonly formatDuration = formatDuration;
  protected readonly demo = DEMO_MODE;
  protected readonly issues = signal<readonly IssueLine[]>([]);
  protected readonly issuesLoading = signal(false);
  protected readonly generated = signal('');

  protected readonly data = computed(() => {
    const d = this.store.overview();
    return d && d.date === this.store.date() ? d : null;
  });
  protected readonly workers = computed(() =>
    [...(this.data()?.workers ?? [])].sort((a, b) => b.minutesToday - a.minutesToday || a.user.displayName.localeCompare(b.user.displayName)),
  );
  protected readonly orders = computed(() =>
    [...(this.data()?.orders ?? [])].sort((a, b) => STATUS_RANK[a.order.status] - STATUS_RANK[b.order.status] || (a.order.code ?? '').localeCompare(b.order.code ?? '')),
  );
  protected readonly totals = computed(() => {
    const d = this.data();
    return {
      hours: minutesToHours((d?.workers ?? []).reduce((s, w) => s + w.minutesToday, 0)),
      inProgress: (d?.orders ?? []).filter((o) => o.order.status === 'IN_PROGRESS').length,
      completed: (d?.orders ?? []).filter((o) => o.order.status === 'COMPLETED').length,
    };
  });
  protected readonly cachedAt = computed(() => {
    const at = this.store.savedAt();
    return at ? `${this.i18n.date(at)} ${this.i18n.time(at)}` : '';
  });

  private issueSeq = 0;

  constructor() {
    effect(() => {
      const requested = this.date();
      untracked(() => {
        if (requested && isIsoDate(requested) && requested !== this.store.date()) {
          this.store.setDate(requested);
        } else if (!this.store.overview() || this.store.overview()?.date !== this.store.date()) {
          void this.store.load();
        }
      });
    });
    effect(() => {
      const d = this.data();
      untracked(() => {
        this.generated.set(`${this.i18n.date(Date.now())} ${this.i18n.time(Date.now())}`);
        void this.loadIssues(d?.orders.filter((o) => o.order.status === 'ISSUE') ?? []);
      });
    });
  }

  protected print(): void {
    this.generated.set(`${this.i18n.date(Date.now())} ${this.i18n.time(Date.now())}`);
    this.document.defaultView?.print();
  }

  protected presenceKey(p: string): TranslationKey {
    return `mgr.presence.${p}` as TranslationKey;
  }

  protected summaryKey(s: string): TranslationKey {
    return `reports.status${s}` as TranslationKey;
  }

  protected unitKey(unit: string): TranslationKey {
    return `unit.${unit}` as TranslationKey;
  }

  protected crewNames(crew: ReadonlyArray<{ readonly displayName: string }>): string {
    return crew.length ? crew.map((c) => c.displayName).join(', ') : this.i18n.t('mgr.unassigned');
  }

  /** Issue texts live on the order detail; fetch them for the few held orders. Offline, the list still names them. */
  private async loadIssues(rows: ReadonlyArray<{ order: WorkOrder }>): Promise<void> {
    const seq = ++this.issueSeq;
    const base: IssueLine[] = rows.map((r) => ({
      code: r.order.code ?? '',
      title: r.order.title,
      assignee: r.order.crew.length ? r.order.crew.map((c) => c.displayName).join(', ') : null,
      logs: [],
    }));
    if (rows.length === 0) {
      this.issues.set([]);
      return;
    }
    this.issuesLoading.set(true);
    const results = await Promise.allSettled(rows.map((r) => this.store.detail(r.order.id)));
    if (seq !== this.issueSeq) return;
    this.issues.set(
      base.map((line, i) => {
        const res = results[i];
        return res?.status === 'fulfilled' ? { ...line, logs: res.value.logs.filter((l) => l.kind === 'ISSUE') } : line;
      }),
    );
    this.issuesLoading.set(false);
  }
}
