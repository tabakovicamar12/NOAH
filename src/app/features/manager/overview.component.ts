import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { OrderOverview, WorkerOverview, WorkerPresence } from '../../core/models/api.models';
import type { DailySummaryStatus, QuantityUnit, Site, WorkOrderStatus } from '../../core/models/domain.models';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { formatDuration, isIsoDate, minutesToHours, toIsoDate } from '../../core/util/util';
import { crewLabel } from '../../shared/ui/format';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { StatusTagComponent } from '../../shared/ui/status-tag.component';
import { progressRatio } from '../../shared/ui/tag-style';
import { ManagerStore } from './data/manager-store.service';
import { OrderDrillComponent } from './order-drill.component';
import { ReportReviewComponent } from './report-review.component';

type SortKey = 'status' | 'code' | 'title' | 'worker' | 'site' | 'today' | 'total' | 'progress';
type View = 'orders' | 'workers';
type Panel = { readonly kind: 'order'; readonly id: string } | { readonly kind: 'report'; readonly id: string };

/** A row in the orders table: a server row, or an order saved on this device that is still on its way. */
interface OrderRow extends OrderOverview {
  readonly pending: boolean;
  readonly crewNames: readonly string[];
}

const STATUS_RANK: Readonly<Record<WorkOrderStatus, number>> = { ISSUE: 0, IN_PROGRESS: 1, NEW: 2, COMPLETED: 3 };
const PRESENCE_RANK: Readonly<Record<WorkerPresence, number>> = { WORKING: 0, FINISHED: 1, NOT_STARTED: 2 };
const PRESENCE_STYLE: Readonly<Record<WorkerPresence, { readonly cls: string; readonly icon: IconName }>> = {
  WORKING: { cls: 'bg-gold text-ink', icon: 'play' },
  FINISHED: { cls: 'bg-charcoal text-white', icon: 'check' },
  NOT_STARTED: { cls: 'bg-stock text-ink ring-2 ring-inset ring-charcoal', icon: 'minus' },
};

@Component({
  selector: 'aon-manager-overview',
  imports: [RouterLink, IconComponent, StatusTagComponent, ReportStatusComponent, OrderDrillComponent, ReportReviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lg:grid" [class]="panel() ? 'xl:grid-cols-[minmax(0,1fr)_27rem]' : ''">
      <div class="min-w-0 px-4 pb-10 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <!-- Header -->
        <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h1 class="font-cond-tight text-[2.5rem] leading-none sm:text-5xl">
              {{ store.isToday() ? i18n.t('mgr.titleToday', { date: i18n.dateLong(store.date()) }) : i18n.dateLong(store.date()) }}
            </h1>
            <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
              @if (data(); as d) {
                <span class="font-semibold">{{ i18n.t('mgr.subtitle', { sites: d.sites.length, workers: d.workers.length }) }}</span>
              }
              @if (demo) {
                <span class="border-2 border-dashed border-charcoal px-2 py-0.5 label-caps text-ink">{{ i18n.t('common.demo') }}</span>
              }
            </p>
          </div>
          <div class="flex flex-wrap items-end gap-2">
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('mgr.date') }}</span>
              <input
                type="date"
                class="mt-1 block min-h-12 border-2 border-charcoal bg-stock px-3 font-semibold outline-none focus:ring-4 focus:ring-gold"
                [value]="store.date()"
                [max]="today"
                (change)="onDate($event)"
              />
            </label>
            <button
              type="button"
              class="flex min-h-12 items-center gap-2 border-2 border-charcoal bg-stock px-4 font-cond text-lg hover:bg-ground-deep disabled:opacity-50"
              [disabled]="store.state() === 'LOADING'"
              (click)="store.load()"
            >
              <aon-icon name="refresh" [size]="18" [class.animate-spin]="store.state() === 'LOADING'" />{{ i18n.t('mgr.refresh') }}
            </button>
            <a routerLink="/m/orders/new" class="flex min-h-12 items-center gap-2 bg-charcoal px-5 font-cond text-lg text-white no-underline hover:bg-charcoal-deep">
              <aon-icon name="plus" [size]="20" [stroke]="3" />{{ i18n.t('mgr.newOrder') }}
            </a>
            <a
              routerLink="/m/report"
              [queryParams]="{ date: store.date() }"
              class="flex min-h-12 items-center gap-2 bg-gold px-5 font-cond text-lg text-ink no-underline hover:brightness-95"
            >
              <aon-icon name="printer" [size]="20" />{{ i18n.t('mgr.exportPdf') }}
            </a>
          </div>
        </header>

        <!-- Truthful data state -->
        @switch (store.state()) {
          @case ('CACHED') {
            <p class="mt-5 flex items-center gap-2 border-2 border-dashed border-charcoal bg-stock px-4 py-3 font-semibold" role="status">
              <aon-icon name="cloud-off" [size]="20" class="text-hold" />{{ i18n.t('mgr.offlineCached', { time: cachedAt() }) }}
            </p>
          }
          @case ('EMPTY_OFFLINE') {
            <p class="mt-5 flex items-center gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
              <aon-icon name="cloud-off" [size]="20" />{{ i18n.t('mgr.offlineNoCache') }}
            </p>
          }
          @case ('ERROR') {
            <div class="mt-5 flex flex-wrap items-center gap-3 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
              <aon-icon name="alert" [size]="20" />{{ i18n.t('mgr.loadFailed') }}
              <button type="button" class="min-h-11 bg-charcoal px-4 font-cond text-white" (click)="store.load()">{{ i18n.t('common.retry') }}</button>
            </div>
          }
        }

        @if (data(); as d) {
          <!-- KPI cells -->
          <dl class="mt-6 grid grid-cols-2 border-2 border-charcoal bg-stock md:grid-cols-5">
            <div class="kpi border-b-2 border-r-2 border-charcoal md:border-b-0">
              <dt class="label-caps text-ink-muted">{{ i18n.t('mgr.kpiWorking') }}</dt>
              <dd class="kpi-n">{{ kpi().working }}<span class="text-2xl text-ink-muted"> / {{ d.workers.length }}</span></dd>
              <dd class="text-sm text-ink-muted">{{ i18n.t('mgr.kpiWorkingSub', { n: kpi().notStarted }) }}</dd>
            </div>
            <div class="kpi border-b-2 border-charcoal md:border-b-0 md:border-r-2">
              <dt class="label-caps text-ink-muted">{{ i18n.t('mgr.kpiHours') }}</dt>
              <dd class="kpi-n">{{ i18n.number(kpi().hours) }}<span class="text-2xl text-ink-muted"> h</span></dd>
              <dd class="text-sm text-ink-muted">{{ i18n.t('mgr.kpiHoursSub') }}</dd>
            </div>
            <div class="kpi border-b-2 border-r-2 border-charcoal md:border-b-0">
              <dt class="label-caps text-ink-muted">{{ i18n.t('mgr.kpiProgress') }}</dt>
              <dd class="kpi-n">{{ kpi().inProgress }}</dd>
              <dd class="text-sm text-ink-muted">{{ i18n.t('mgr.kpiProgressSub') }}</dd>
            </div>
            <div class="kpi border-b-2 border-charcoal md:border-b-0 md:border-r-2" [class]="kpi().issues > 0 ? 'bg-hold text-white' : ''">
              <dt class="flex items-center gap-1.5 label-caps" [class.text-ink-muted]="kpi().issues === 0">
                @if (kpi().issues > 0) {
                  <aon-icon name="alert" [size]="14" [stroke]="3" />
                }
                {{ i18n.t('mgr.kpiIssues') }}
              </dt>
              <dd class="kpi-n">{{ kpi().issues }}</dd>
              <dd class="text-sm" [class]="kpi().issues > 0 ? 'text-white/85' : 'text-ink-muted'">{{ i18n.t('mgr.kpiIssuesSub') }}</dd>
            </div>
            <div class="col-span-2 md:col-span-1">
              <button
                type="button"
                class="kpi block h-full w-full text-left"
                [class]="store.toReview().length ? 'bg-charcoal text-white hover:bg-charcoal-deep' : 'cursor-default'"
                [disabled]="!store.toReview().length"
                [attr.aria-label]="i18n.t('mgr.kpiReviewAria', { n: store.toReview().length })"
                (click)="openNextReport()"
              >
                <span class="flex items-center justify-between gap-1.5 label-caps" [class]="store.toReview().length ? 'text-on-dark-muted' : 'text-ink-muted'">
                  {{ i18n.t('mgr.kpiReview') }}
                  @if (store.toReview().length) {
                    <aon-icon name="chevron-right" [size]="18" [stroke]="3" />
                  }
                </span>
                <span class="kpi-n block">{{ store.toReview().length }}</span>
                <span class="block text-sm" [class]="store.toReview().length ? 'text-on-dark-muted' : 'text-ink-muted'">{{ i18n.t('mgr.kpiReviewSub', { n: store.toReview().length }) }}</span>
              </button>
            </div>
          </dl>

          <!-- Filters -->
          <div class="mt-6 flex flex-wrap items-center gap-2">
            <div class="flex flex-wrap gap-2" role="group" [attr.aria-label]="i18n.t('mgr.filterSites')">
              <button type="button" class="chip" [class.on]="site() === null" [attr.aria-pressed]="site() === null" (click)="site.set(null)">
                {{ i18n.t('mgr.allSites') }}
              </button>
              @for (s of d.sites; track s.id) {
                <button type="button" class="chip" [class.on]="site() === s.id" [attr.aria-pressed]="site() === s.id" [title]="s.projectName + ' · ' + s.name" (click)="site.set(s.id)">
                  <span class="font-cond text-base">{{ s.code }}</span> {{ chipLabel(s) }}
                </button>
              }
            </div>
            <button
              type="button"
              class="chip"
              [class.on-hold]="onlyIssues()"
              [attr.aria-pressed]="onlyIssues()"
              (click)="onlyIssues.set(!onlyIssues())"
            >
              <aon-icon name="alert" [size]="16" [stroke]="2.75" />{{ i18n.t('mgr.onlyIssues') }}
            </button>
          </div>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label class="relative block w-full sm:w-80">
              <span class="sr-only">{{ i18n.t('mgr.search') }}</span>
              <aon-icon name="search" [size]="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                class="block min-h-12 w-full border-2 border-charcoal bg-stock pl-10 pr-3 font-semibold outline-none placeholder:font-normal placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
                [placeholder]="i18n.t('mgr.search')"
                [value]="query()"
                (input)="query.set($any($event.target).value)"
              />
            </label>
            <div class="inline-flex border-2 border-charcoal" role="group" [attr.aria-label]="i18n.t('mgr.view')">
              @for (v of views; track v.id) {
                <button
                  type="button"
                  class="flex min-h-11 items-center gap-2 px-4 font-cond text-lg"
                  [class]="view() === v.id ? 'bg-charcoal text-white' : 'bg-stock text-ink hover:bg-ground-deep'"
                  [attr.aria-pressed]="view() === v.id"
                  (click)="view.set(v.id)"
                >
                  <aon-icon [name]="v.icon" [size]="18" />{{ i18n.t(v.label) }}
                </button>
              }
            </div>
          </div>

          @if (view() === 'orders') {
            <!-- Orders table -->
            <div class="mt-3 overflow-x-auto border-2 border-charcoal bg-stock">
              <table class="w-full min-w-[60rem] border-collapse text-left">
                <thead class="bg-charcoal text-white">
                  <tr>
                    @for (col of orderCols; track col.key) {
                      <th scope="col" class="px-2.5 py-0 font-normal" [class.text-right]="col.num" [attr.aria-sort]="ariaSort(col.key)">
                        <button
                          type="button"
                          class="flex min-h-11 w-full items-center gap-1 label-caps"
                          [class.justify-end]="col.num"
                          [attr.aria-label]="i18n.t('mgr.sortBy', { col: i18n.t(col.label) })"
                          (click)="sortBy(col.key)"
                        >
                          {{ i18n.t(col.label) }}
                          <span class="inline-flex w-4 text-gold">
                            @if (sort().key === col.key) {
                              <aon-icon [name]="sort().dir === 1 ? 'chevron-up' : 'chevron-down'" [size]="16" [stroke]="3" />
                            }
                          </span>
                        </button>
                      </th>
                    }
                    <th scope="col" class="px-2.5 text-right label-caps">{{ i18n.t('mgr.colPhotos') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of orderRows(); track row.order.id) {
                    @let isOpen = panel()?.kind === 'order' && panel()?.id === row.order.id;
                    <tr
                      class="cursor-pointer border-b border-rule-soft last:border-b-0"
                      [class]="isOpen ? 'bg-gold-pale' : 'hover:bg-ground'"
                      [attr.aria-selected]="isOpen"
                      (click)="openRow(row)"
                    >
                      <td class="px-2.5 py-2.5">
                        @if (row.pending) {
                          <span class="inline-flex items-center gap-1.5 border-2 border-dashed border-charcoal px-2 py-1 label-caps leading-none"><aon-icon name="refresh" [size]="13" [stroke]="3" />{{ i18n.t('mgr.pendingSync') }}</span>
                        } @else if (!row.order.published) {
                          <span class="inline-flex items-center gap-1.5 border-2 border-dashed border-charcoal px-2 py-1 label-caps leading-none"><aon-icon name="note" [size]="13" [stroke]="3" />{{ i18n.t('mgr.draft') }}</span>
                        } @else {
                          <aon-status-tag [status]="row.order.status" size="sm" />
                        }
                      </td>
                      <td class="px-2.5 py-2.5">
                        <button
                          type="button"
                          class="whitespace-nowrap font-cond-tight text-xl leading-none underline decoration-transparent underline-offset-4 hover:decoration-current"
                          [class.text-ink-muted]="!row.order.code"
                          [attr.aria-label]="i18n.t('orders.open', { code: row.order.code ?? row.order.title })"
                          [attr.aria-expanded]="isOpen"
                          (click)="$event.stopPropagation(); openRow(row)"
                        >
                          {{ row.order.code ?? i18n.t('form.numberPending') }}
                        </button>
                      </td>
                      <td class="max-w-[13rem] px-2.5 py-2.5">
                        <span class="block truncate font-semibold">{{ row.order.title }}</span>
                        <span class="block truncate text-sm text-ink-muted">{{ row.order.location }}</span>
                      </td>
                      <td class="whitespace-nowrap px-2.5 py-2.5" [class.text-ink-muted]="!row.crewNames.length" [title]="row.crewNames.join(', ')">
                        @if (row.crewNames.length > 1) {
                          <span class="inline-flex items-center gap-1.5"><aon-icon name="users" [size]="15" class="text-ink-muted" />{{ crew(row.crewNames) }}</span>
                        } @else {
                          {{ crew(row.crewNames) }}
                        }
                      </td>
                      <td class="whitespace-nowrap px-2.5 py-2.5 text-[0.95rem]" [title]="siteLabel(row.order.siteId)">{{ siteById().get(row.order.siteId)?.projectName ?? row.order.siteName }}</td>
                      <td class="px-2.5 py-2.5 text-right font-cond text-lg">{{ duration(row.minutesToday) }}</td>
                      <td class="px-2.5 py-2.5 text-right font-cond text-lg">{{ duration(row.minutesTotal) }}</td>
                      <td class="px-2.5 py-2.5">
                        <span class="flex items-center justify-end gap-2 whitespace-nowrap">
                          <span class="font-cond text-lg">{{ i18n.number(row.order.doneQty) }}/{{ i18n.number(row.order.plannedQty) }} {{ i18n.t(unitKey(row.order.unit)) }}</span>
                          <span class="h-2.5 w-12 shrink-0 border border-charcoal bg-ground" aria-hidden="true">
                            <span class="block h-full" [class]="row.order.status === 'COMPLETED' ? 'bg-done' : 'bg-charcoal'" [style.width.%]="progress(row) * 100"></span>
                          </span>
                        </span>
                      </td>
                      <td class="px-2.5 py-2.5 text-right font-cond text-lg">{{ row.photoCount }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="9" class="px-4 py-10 text-center">
                        <p class="font-cond text-xl">{{ i18n.t('mgr.noResults') }}</p>
                        <button type="button" class="mt-3 min-h-11 bg-charcoal px-4 font-cond text-lg text-white" (click)="clearFilters()">{{ i18n.t('mgr.clearFilters') }}</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <!-- Workers table -->
            <div class="mt-3 overflow-x-auto border-2 border-charcoal bg-stock">
              <table class="w-full min-w-[52rem] border-collapse text-left">
                <thead class="bg-charcoal text-white">
                  <tr>
                    @for (h of workerCols; track h) {
                      <th scope="col" class="px-3 py-3 label-caps">{{ i18n.t(h) }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (w of workerRows(); track w.user.id) {
                    @let p = PRESENCE_STYLE[w.presence];
                    <tr class="border-b border-rule-soft last:border-b-0">
                      <td class="px-2.5 py-2.5">
                        <span class="tag-sm tag-shape-sm inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap py-1 pr-2.5 label-caps leading-none" [class]="p.cls">
                          <span class="tag-eyelet"></span><aon-icon [name]="p.icon" [size]="14" [stroke]="3" />{{ i18n.t(presenceKey(w.presence)) }}
                        </span>
                      </td>
                      <td class="px-2.5 py-2.5">
                        <span class="block font-semibold">{{ w.user.displayName }}</span>
                        <span class="block text-sm text-ink-muted">{{ w.user.crew }}</span>
                      </td>
                      <!-- Report status sits beside the name so it stays visible when the review panel narrows the table. -->
                      <td class="px-2.5 py-2.5">
                        @if (w.summaryId && w.summaryStatus) {
                          <button type="button" class="flex items-center gap-1" [attr.aria-label]="i18n.t('mgr.openReport', { name: w.user.displayName })" (click)="openReport(w.summaryId)">
                            <aon-report-status [status]="statusOf(w.summaryStatus)" /><aon-icon name="chevron-right" [size]="18" />
                          </button>
                        } @else {
                          <span class="text-ink-muted">{{ i18n.t('common.none') }}</span>
                        }
                      </td>
                      <td class="px-2.5 py-2.5 text-[0.95rem]">{{ w.site ? w.site.projectName + ' · ' + w.site.name : i18n.t('common.none') }}</td>
                      <td class="px-2.5 py-2.5">
                        @if (w.activeOrderCode; as code) {
                          <button type="button" class="whitespace-nowrap font-cond-tight text-xl underline underline-offset-4" (click)="selectByCode(code)">{{ code }}</button>
                        } @else {
                          <span class="text-ink-muted">{{ i18n.t('mgr.noActiveOrder') }}</span>
                        }
                      </td>
                      <td class="px-2.5 py-2.5 font-cond text-lg">{{ w.shiftStartedAt ? i18n.time(w.shiftStartedAt) : i18n.t('common.none') }}</td>
                      <td class="px-2.5 py-2.5 font-cond text-lg">{{ duration(w.minutesToday) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="7" class="px-4 py-10 text-center">
                        <p class="font-cond text-xl">{{ i18n.t('mgr.noWorkers') }}</p>
                        <button type="button" class="mt-3 min-h-11 bg-charcoal px-4 font-cond text-lg text-white" (click)="clearFilters()">{{ i18n.t('mgr.clearFilters') }}</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else if (store.state() === 'LOADING') {
          <div class="mt-6 grid gap-3" aria-busy="true">
            <div class="h-28 animate-pulse bg-ground-deep"></div>
            <div class="h-12 w-1/2 animate-pulse bg-ground-deep"></div>
            <div class="h-80 animate-pulse bg-ground-deep"></div>
            <span class="sr-only">{{ i18n.t('common.loading') }}</span>
          </div>
        }
      </div>

      @if (panel(); as p) {
        <aside
          class="drill fixed inset-y-0 right-0 z-50 w-[min(27rem,100vw)] overflow-y-auto border-l-2 border-charcoal bg-ground shadow-[0_0_48px_-12px_rgb(0_0_0/0.45)] xl:sticky xl:top-0 xl:z-auto xl:h-dvh xl:w-auto xl:shadow-none"
          role="region"
          aria-labelledby="drill-title"
        >
          @if (p.kind === 'order') {
            <aon-order-drill [orderId]="p.id" [code]="selectedCode()" (closed)="panel.set(null)" (openReport)="openReport($event)" />
          } @else {
            <aon-report-review [summaryId]="p.id" (closed)="panel.set(null)" />
          }
        </aside>
      }
    </div>
  `,
  styles: `
    .kpi {
      padding: 1rem 1.25rem 1.1rem;
    }
    .kpi-n {
      margin-top: 0.25rem;
      font-stretch: 62%;
      font-weight: 850;
      font-size: 3.25rem;
      line-height: 0.95;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.75rem;
      padding: 0 0.9rem;
      border: 2px solid var(--color-charcoal);
      background: var(--color-stock);
      font-weight: 700;
      transition: background-color 150ms var(--ease-out-expo);
    }
    .chip:hover {
      background: var(--color-ground-deep);
    }
    .chip.on {
      background: var(--color-charcoal);
      color: #fff;
    }
    .chip.on-hold {
      background: var(--color-hold);
      border-color: var(--color-hold);
      color: #fff;
    }
    .drill {
      animation: drill-in 220ms var(--ease-out-expo) both;
    }
    @keyframes drill-in {
      from {
        transform: translateX(1.5rem);
        opacity: 0;
      }
    }
  `,
})
export class OverviewComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ManagerStore);
  private readonly router = inject(Router);

  protected readonly PRESENCE_STYLE = PRESENCE_STYLE;
  protected readonly demo = DEMO_MODE;
  protected readonly today = toIsoDate();

  protected readonly site = signal<string | null>(null);
  protected readonly onlyIssues = signal(false);
  protected readonly query = signal('');
  protected readonly view = signal<View>('orders');
  protected readonly sort = signal<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  protected readonly panel = signal<Panel | null>(null);

  protected readonly views: ReadonlyArray<{ id: View; label: TranslationKey; icon: IconName }> = [
    { id: 'orders', label: 'mgr.viewOrders', icon: 'list' },
    { id: 'workers', label: 'mgr.viewWorkers', icon: 'users' },
  ];
  protected readonly orderCols: ReadonlyArray<{ key: SortKey; label: TranslationKey; num: boolean }> = [
    { key: 'status', label: 'mgr.colStatus', num: false },
    { key: 'code', label: 'mgr.colCode', num: false },
    { key: 'title', label: 'mgr.colTitle', num: false },
    { key: 'worker', label: 'mgr.colCrew', num: false },
    { key: 'site', label: 'mgr.colProject', num: false },
    { key: 'today', label: 'mgr.colToday', num: true },
    { key: 'total', label: 'mgr.colTotal', num: true },
    { key: 'progress', label: 'mgr.colProgress', num: true },
  ];
  protected readonly workerCols: readonly TranslationKey[] = [
    'mgr.colPresence',
    'mgr.colWorker',
    'mgr.colSummary',
    'mgr.colSite',
    'mgr.colActive',
    'mgr.colSince',
    'mgr.colHours',
  ];

  protected readonly data = this.store.overview;

  protected readonly cachedAt = computed(() => {
    const at = this.store.savedAt();
    return at ? `${this.i18n.date(at)} ${this.i18n.time(at)}` : '';
  });

  protected readonly kpi = computed(() => {
    const d = this.data();
    const workers = d?.workers ?? [];
    const orders = d?.orders ?? [];
    return {
      working: workers.filter((w) => w.presence === 'WORKING').length,
      notStarted: workers.filter((w) => w.presence === 'NOT_STARTED').length,
      hours: minutesToHours(workers.reduce((sum, w) => sum + w.minutesToday, 0)),
      inProgress: orders.filter((o) => o.order.status === 'IN_PROGRESS').length,
      issues: orders.filter((o) => o.order.status === 'ISSUE').length,
    };
  });

  protected readonly siteById = computed(() => new Map((this.data()?.sites ?? []).map((s) => [s.id, s])));

  /** Server rows, with orders saved on this device laid over them until the server confirms. */
  private readonly allRows = computed<readonly OrderRow[]>(() => {
    const server = this.data()?.orders ?? [];
    const pending = this.store.authored();
    const names = new Map<string, string>();
    for (const w of this.data()?.workers ?? []) names.set(w.user.id, w.user.displayName);
    for (const w of this.store.directory()?.workers ?? []) names.set(w.user.id, w.user.displayName);
    const pendingById = new Map(pending.map((p) => [p.id, p]));
    const rows: OrderRow[] = server.map((r) => {
      const local = pendingById.get(r.order.id);
      const order = local
        ? { ...r.order, title: local.title, location: local.location, crew: local.crewIds.map((id) => ({ id, displayName: names.get(id) ?? id })), published: local.published || r.order.published, plannedQty: local.plannedQty, unit: local.unit }
        : r.order;
      return { ...r, order, pending: !!local, crewNames: order.crew.map((c) => c.displayName) };
    });
    for (const p of pending) {
      if (server.some((r) => r.order.id === p.id)) continue;
      const site = this.siteById().get(p.siteId) ?? this.store.directory()?.sites.find((s) => s.id === p.siteId);
      const crewNames = p.crewIds.map((id) => names.get(id) ?? id);
      rows.push({
        order: {
          id: p.id,
          code: null,
          title: p.title,
          description: p.description,
          projectId: site?.projectId ?? '',
          siteId: p.siteId,
          siteName: site ? `${site.projectName} · ${site.name}` : '',
          location: p.location,
          crew: p.crewIds.map((id, i) => ({ id, displayName: crewNames[i] ?? id })),
          managerId: '',
          managerName: '',
          status: 'NEW',
          published: p.published,
          unit: p.unit,
          plannedQty: p.plannedQty,
          doneQty: 0,
          estimatedMinutes: p.estimatedMinutes,
          materials: p.materials,
          date: p.date,
          dueDate: p.dueDate,
          updatedAt: p.savedAt,
        },
        minutesToday: 0,
        minutesTotal: 0,
        photoCount: 0,
        openIssues: 0,
        pending: true,
        crewNames,
      });
    }
    return rows;
  });

  protected readonly orderRows = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const site = this.site();
    const { key, dir } = this.sort();
    const rows = this.allRows().filter(
      (r) =>
        (site === null || r.order.siteId === site) &&
        (!this.onlyIssues() || r.order.status === 'ISSUE') &&
        (!q || `${r.order.code ?? ''} ${r.order.title} ${r.crewNames.join(' ')} ${r.order.location}`.toLocaleLowerCase().includes(q)),
    );
    const value = (r: OrderRow): number | string => {
      switch (key) {
        case 'status':
          return r.pending ? -2 : !r.order.published ? -1 : STATUS_RANK[r.order.status];
        case 'code':
          return r.order.code ?? '';
        case 'title':
          return r.order.title;
        case 'worker':
          return r.crewNames[0] ?? '￿';
        case 'site':
          return this.siteLabel(r.order.siteId);
        case 'today':
          return r.minutesToday;
        case 'total':
          return r.minutesTotal;
        case 'progress':
          return this.progress(r);
      }
    };
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), this.i18n.locale());
      return c * dir || (a.order.code ?? '').localeCompare(b.order.code ?? '');
    });
  });

  protected readonly workerRows = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const site = this.site();
    const withIssues = new Set((this.data()?.orders ?? []).filter((o) => o.order.status === 'ISSUE').flatMap((o) => o.order.crew.map((c) => c.id)));
    return (this.data()?.workers ?? [])
      .filter(
        (w: WorkerOverview) =>
          (site === null || w.site?.id === site) &&
          (!this.onlyIssues() || withIssues.has(w.user.id)) &&
          (!q || `${w.user.displayName} ${w.user.crew ?? ''} ${w.activeOrderCode ?? ''}`.toLocaleLowerCase().includes(q)),
      )
      .sort((a, b) => PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence] || a.user.displayName.localeCompare(b.user.displayName));
  });

  protected readonly selectedCode = computed(() => {
    const p = this.panel();
    return p?.kind === 'order' ? (this.data()?.orders.find((o) => o.order.id === p.id)?.order.code ?? '') : '';
  });

  /** `?order=<id>` from the projects list opens that order's drill-down. */
  readonly order = input<string | undefined>(undefined);

  ngOnInit(): void {
    void this.store.load();
    void this.store.loadDirectory();
    const id = this.order();
    if (id) this.panel.set({ kind: 'order', id });
  }

  protected onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (isIsoDate(value)) {
      this.panel.set(null);
      this.store.setDate(value);
    }
  }

  protected sortBy(key: SortKey): void {
    this.sort.update((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | null {
    const s = this.sort();
    return s.key === key ? (s.dir === 1 ? 'ascending' : 'descending') : null;
  }

  /** Server rows open the drill-down; an order still on its way can only be edited. */
  protected openRow(row: OrderRow): void {
    if (row.pending && !this.data()?.orders.some((o) => o.order.id === row.order.id)) {
      void this.router.navigate(['/m/orders', row.order.id, 'edit']);
      return;
    }
    const p = this.panel();
    this.panel.set(p?.kind === 'order' && p.id === row.order.id ? null : { kind: 'order', id: row.order.id });
  }

  protected openReport(id: string): void {
    this.panel.set({ kind: 'report', id });
  }

  protected openNextReport(): void {
    const next = this.store.toReview()[0];
    if (next) this.openReport(next.id);
  }

  protected selectByCode(code: string): void {
    const row = this.data()?.orders.find((o) => o.order.code === code);
    if (row) this.panel.set({ kind: 'order', id: row.order.id });
  }

  protected clearFilters(): void {
    this.site.set(null);
    this.onlyIssues.set(false);
    this.query.set('');
  }

  protected siteLabel(siteId: string): string {
    const s = this.siteById().get(siteId);
    return s ? `${s.projectName} · ${s.name}` : siteId;
  }

  /** The project name, unless the project has several objects: then the object tells them apart. */
  protected chipLabel(s: Site): string {
    const siblings = (this.data()?.sites ?? []).filter((x) => x.projectId === s.projectId).length;
    return siblings > 1 ? s.name : s.projectName;
  }

  protected crew(names: readonly string[]): string {
    return crewLabel(names, this.i18n.t('mgr.unassigned'));
  }

  protected progress(r: OrderOverview): number {
    return progressRatio(r.order.doneQty, r.order.plannedQty);
  }

  protected duration(minutes: number): string {
    return minutes > 0 ? formatDuration(minutes) : this.i18n.t('common.none');
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected presenceKey(p: WorkerPresence): TranslationKey {
    return `mgr.presence.${p}`;
  }

  protected statusOf(s: DailySummaryStatus): DailySummaryStatus {
    return s;
  }
}
