import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { OrderOverview, WorkerOverview, WorkerPresence } from '../../core/models/api.models';
import type { DailySummary, DailySummaryStatus, QuantityUnit, WorkOrderStatus } from '../../core/models/domain.models';
import { compareCodes, formatDuration, isIsoDate, toIsoDate } from '../../core/util/util';
import { IconComponent } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { progressRatio } from '../../shared/ui/tag-style';
import { ManagerStore } from './data/manager-store.service';
import { OrderDrillComponent } from './order-drill.component';
import { avatarTone, initialsOf } from './person';
import { ReportReviewComponent } from './report-review.component';

type SortKey = 'code' | 'title' | 'where' | 'worker' | 'status' | 'progress';
type Panel = { readonly kind: 'order'; readonly id: string } | { readonly kind: 'report'; readonly id: string };
type StatusTab = 'ALL' | WorkOrderStatus;

/** A row in the orders table: a server row, or an order saved on this device that is still on its way. */
interface OrderRow extends OrderOverview {
  readonly pending: boolean;
  readonly crewNames: readonly string[];
  readonly projectName: string;
  readonly siteLabel: string;
}

const STATUS_RANK: Readonly<Record<WorkOrderStatus, number>> = { ISSUE: 0, IN_PROGRESS: 1, NEW: 2, COMPLETED: 3 };
/** Orders per table page; the manager pages through the rest. */
const PAGE_SIZE = 8;
const PRESENCE_RANK: Readonly<Record<WorkerPresence, number>> = { WORKING: 0, FINISHED: 1, NOT_STARTED: 2 };

/**
 * Work orders: the day, a search, a status filter with live counts and the table; the selected order
 * opens in the inspector at the right edge without leaving the list.
 */
@Component({
  selector: 'aon-manager-overview',
  imports: [NgTemplateOutlet, RouterLink, IconComponent, ReportStatusComponent, OrderDrillComponent, ReportReviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <div class="page" [class.has-inspector]="!!panel()">
      <div class="work">
        <div class="topline">
          <label class="day">
            <span class="sr-only">{{ i18n.t('mgr.dayLabel') }}</span>
            <span>{{ dayLabel() }}</span>
            <aon-icon name="chevron-down" [size]="18" [stroke]="1.8" />
            <input type="date" [value]="store.date()" [max]="today" (change)="onDate($event)" />
          </label>
        </div>

        <div class="titleline">
          <h1 class="title">{{ mode() === 'workers' ? i18n.t('mgr.navTeam') : mode() === 'reviews' ? i18n.t('mgr.reviewsTitle') : i18n.t('mgr.navOrders') }}@if (scopeName()) {<span class="sr-only"> · {{ scopeName() }}</span>}</h1>
          @if (mode() === 'orders') {
            <a routerLink="/m/orders/new" class="new"><aon-icon name="plus" [size]="18" [stroke]="2.2" />{{ i18n.t('mgr.navNewOrder') }}</a>
          }
        </div>

        <label class="search">
          <span class="sr-only">{{ i18n.t('mgr.searchOrders') }}</span>
          <aon-icon name="search" [size]="21" [stroke]="1.8" class="search-icon" />
          <kbd class="kbd" aria-hidden="true">⌘K</kbd>
          <input #search type="search" autocomplete="off" [placeholder]="i18n.t(mode() === 'workers' ? 'mgr.filterTeam' : mode() === 'reviews' ? 'mgr.searchReports' : 'mgr.searchOrders')" [value]="store.query()" (input)="store.query.set($any($event.target).value)" />
        </label>

        @switch (store.state()) {
          @case ('CACHED') {
            <p class="banner" role="status"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('mgr.offlineCached', { time: cachedAt() }) }}</p>
          }
          @case ('EMPTY_OFFLINE') {
            <p class="banner banner-bad" role="alert"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('mgr.offlineNoCache') }}</p>
          }
          @case ('ERROR') {
            <div class="banner banner-bad" role="alert">
              <aon-icon name="alert" [size]="18" />{{ i18n.t('mgr.loadFailed') }}
              <button type="button" class="banner-btn" (click)="store.load()">{{ i18n.t('common.retry') }}</button>
            </div>
          }
        }

        <ng-template #scopePicker>
          @if (scopeProjects().length) {
            <div class="scope" role="group" [attr.aria-label]="i18n.t('mgr.treeLabel')">
              <label class="scope-field" [class.is-set]="!!scopeProjectId()">
                <span class="sr-only">{{ i18n.t('form.project') }}</span>
                <select (change)="pickProject($any($event.target).value)">
                  <option value="" [selected]="!scopeProjectId()">{{ i18n.t('mgr.scopeAllProjects') }}</option>
                  @for (p of scopeProjects(); track p.id) {
                    <option [value]="p.id" [selected]="p.id === scopeProjectId()">{{ p.name }}</option>
                  }
                </select>
                <aon-icon name="chevron-down" [size]="16" [stroke]="2" />
              </label>
              <label class="scope-field" [class.is-set]="!!site()">
                <span class="sr-only">{{ i18n.t('form.site') }}</span>
                <select (change)="pickSite($any($event.target).value)">
                  <option value="" [selected]="!site()">{{ i18n.t('mgr.treeAll') }}</option>
                  @for (g of scopeSiteGroups(); track g.project.id) {
                    <optgroup [label]="g.project.name">
                      @for (s of g.sites; track s.id) {
                        <option [value]="s.id" [selected]="s.id === site()">{{ s.name }}</option>
                      }
                    </optgroup>
                  }
                </select>
                <aon-icon name="chevron-down" [size]="16" [stroke]="2" />
              </label>
            </div>
          }
        </ng-template>

        <!-- The team and the reports narrow to a project or object the same way the orders do. -->
        @if (mode() !== 'orders' && data() && scopeProjects().length) {
          <div class="filter-bar">
            <ng-container *ngTemplateOutlet="scopePicker" />
          </div>
        }

        @if (mode() === 'orders') {
          <div class="filter-bar">
            <div class="flt" role="group" [attr.aria-label]="i18n.t('mgr.tabsLabel')">
              @for (t of tabs; track t.id) {
                <button type="button" class="flt-btn" [attr.aria-pressed]="status() === t.id" (click)="status.set(t.id)">{{ i18n.t(t.label) }}<span class="flt-n">{{ counts()[t.id] }}</span></button>
              }
            </div>
            <ng-container *ngTemplateOutlet="scopePicker" />
          </div>

          @if (data() && !store.isToday()) {
            <p class="day-note">
              <aon-icon name="calendar" [size]="16" />
              <span>{{ i18n.t('mgr.dayFilterNote', { date: i18n.dateShort(store.date()) }) }}</span>
              <button type="button" class="day-today" (click)="toToday()">{{ i18n.t('mgr.backToToday') }}</button>
            </p>
          }
          @if (data()) {
            <div class="card">
              <table class="tbl">
                <thead>
                  <tr>
                    @for (col of cols; track col.key) {
                      <th scope="col" [attr.aria-sort]="ariaSort(col.key)" [class]="'c-' + col.key">
                        <button type="button" class="th" (click)="sortBy(col.key)">
                          {{ i18n.t(col.label) }}
                          @if (sort().key === col.key) {
                            <aon-icon [name]="sort().dir === 1 ? 'chevron-up' : 'chevron-down'" [size]="14" [stroke]="2.2" />
                          }
                        </button>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of pageRows(); track row.order.id) {
                    @let isOpen = panel()?.kind === 'order' && panel()?.id === row.order.id;
                    <tr class="row" [class.is-open]="isOpen" [attr.aria-selected]="isOpen" (click)="openRow(row)">
                      <td class="c-code">
                        <button
                          type="button"
                          class="code"
                          [attr.aria-label]="i18n.t('orders.open', { code: row.order.code ?? row.order.title })"
                          [attr.aria-expanded]="isOpen"
                          (click)="$event.stopPropagation(); openRow(row)"
                        >{{ row.order.code ?? i18n.t('form.numberPending') }}</button>
                      </td>
                      <td class="c-title">
                        <span class="clamp">{{ row.order.title }}</span>
                        <span class="where-inline">{{ row.projectName }} · {{ row.siteLabel }}</span>
                      </td>
                      <td class="c-where">
                        <span class="where" [title]="row.order.siteName">
                          <span class="where-p">{{ row.projectName }}</span>
                          <span class="where-s">{{ row.siteLabel }}</span>
                        </span>
                      </td>
                      <td class="c-worker">
                        @if (row.crewNames.length) {
                          <span class="who">
                            <span class="ava" [attr.data-tone]="tone(row.crewNames[0])" aria-hidden="true">{{ initials(row.crewNames[0]) }}</span>
                            <span class="clamp">{{ crew(row.crewNames) }}</span>
                          </span>
                        } @else {
                          <span class="muted">{{ i18n.t('mgr.unassigned') }}</span>
                        }
                      </td>
                      <td class="c-status">
                        @if (row.pending) {
                          <span class="badge badge-wait">{{ i18n.t('mgr.pendingShort') }}</span>
                        } @else if (!row.order.published) {
                          <span class="badge badge-wait">{{ i18n.t('mgr.draftShort') }}</span>
                        } @else {
                          <span class="badge" [attr.data-s]="row.order.status">{{ i18n.t(statusKey(row.order.status)) }}</span>
                        }
                      </td>
                      <td class="c-progress">
                        @if (row.order.status === 'ISSUE') {
                          <span class="muted" [title]="i18n.number(row.order.doneQty) + '/' + i18n.number(row.order.plannedQty)">—</span>
                        } @else {
                          <span class="prog">
                            <span>{{ i18n.number(row.order.doneQty) }}/{{ i18n.number(row.order.plannedQty) }} {{ i18n.t(unitKey(row.order.unit)) }}</span>
                            <span class="prog-bar" aria-hidden="true"><span [style.width.%]="progress(row) * 100"></span></span>
                          </span>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="empty">
                        <p>{{ i18n.t('mgr.noResults') }}</p>
                        <button type="button" class="empty-btn" (click)="clearFilters()">{{ i18n.t('mgr.clearFilters') }}</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (pageCount() > 1) {
              <nav class="pager" [attr.aria-label]="i18n.t('mgr.pagerLabel')">
                <p class="pager-info">{{ i18n.t('mgr.pageOf', { from: pageFrom(), to: pageTo(), n: orderRows().length }) }}</p>
                <div class="pager-btns">
                  <button type="button" class="pg" [disabled]="page() === 0" [attr.aria-label]="i18n.t('mgr.prevPage')" (click)="page.set(page() - 1)"><aon-icon name="chevron-left" [size]="18" /></button>
                  @for (n of pages(); track n) {
                    <button type="button" class="pg" [class.is-on]="page() === n" [attr.aria-current]="page() === n ? 'page' : null" [attr.aria-label]="i18n.t('mgr.pageN', { n: n + 1 })" (click)="page.set(n)">{{ n + 1 }}</button>
                  }
                  <button type="button" class="pg" [disabled]="page() >= pageCount() - 1" [attr.aria-label]="i18n.t('mgr.nextPage')" (click)="page.set(page() + 1)"><aon-icon name="chevron-right" [size]="18" /></button>
                </div>
              </nav>
            }
          }
        } @else if (mode() === 'reviews' && data()) {
          <div class="card">
            <table class="tbl tbl-team">
              <thead>
                <tr>
                  <th scope="col"><span class="th">{{ i18n.t('mgr.colWorker') }}</span></th>
                  <th scope="col"><span class="th">{{ i18n.t('mgr.colDay') }}</span></th>
                  <th scope="col"><span class="th">{{ i18n.t('mgr.colHours') }}</span></th>
                  <th scope="col"><span class="th">{{ i18n.t('mgr.colOrdersWorked') }}</span></th>
                  <th scope="col"><span class="th">{{ i18n.t('mgr.colState') }}</span></th>
                </tr>
              </thead>
              <tbody>
                @for (r of reportRows(); track r.id) {
                  @let isOpen = panel()?.kind === 'report' && panel()?.id === r.id;
                  <tr class="row" [class.is-open]="isOpen" [attr.aria-selected]="isOpen" (click)="openReport(r.id)">
                    <td>
                      <span class="who">
                        <span class="ava" [attr.data-tone]="tone(r.name)" aria-hidden="true">{{ initials(r.name) }}</span>
                        <button type="button" class="code" (click)="$event.stopPropagation(); openReport(r.id)">{{ r.name }}</button>
                      </span>
                    </td>
                    <td class="tabular-nums" [attr.data-label]="i18n.t('mgr.colDay')">{{ r.arrival }}–{{ r.departure }}</td>
                    <td class="tabular-nums" [attr.data-label]="i18n.t('mgr.colHours')">{{ r.hours }}</td>
                    <td class="codes" [attr.data-label]="i18n.t('mgr.colOrdersWorked')">{{ r.orders }}</td>
                    <td [attr.data-label]="i18n.t('mgr.colState')"><aon-report-status [status]="r.status" /></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="empty"><p>{{ i18n.t('mgr.reviewsEmpty') }}</p></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (data()) {
          <div class="card">
            <table class="tbl tbl-team">
              <thead>
                <tr>
                  @for (h of workerCols; track h) {
                    <th scope="col"><span class="th">{{ i18n.t(h) }}</span></th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (w of workerRows(); track w.user.id) {
                  <tr class="row is-static">
                    <td>
                      <span class="who">
                        <span class="ava" [attr.data-tone]="tone(w.user.displayName)" aria-hidden="true">{{ initials(w.user.displayName) }}</span>
                        <span><span class="block">{{ w.user.displayName }}</span><span class="block text-sm muted">{{ w.user.crew }}</span></span>
                      </span>
                    </td>
                    <td><span class="badge" [attr.data-p]="w.presence">{{ i18n.t(presenceKey(w.presence)) }}</span></td>
                    <td [attr.data-label]="i18n.t('mgr.colSite')"><span>@if (w.site) {<span class="whitespace-nowrap">{{ w.site.projectName }}&nbsp;·</span>{{ ' ' }}<span class="whitespace-nowrap">{{ w.site.name }}</span>} @else {{{ i18n.t('common.none') }}}</span></td>
                    <td [attr.data-label]="i18n.t('mgr.colActive')">
                      @if (w.activeOrderCode; as code) {
                        <button type="button" class="code" (click)="selectByCode(code)">{{ code }}</button>
                      } @else {
                        <span class="muted">{{ i18n.t('mgr.noActiveOrder') }}</span>
                      }
                    </td>
                    <td class="tabular-nums" [attr.data-label]="i18n.t('mgr.colSince')">{{ w.shiftStartedAt ? i18n.time(w.shiftStartedAt) : i18n.t('common.none') }}</td>
                    <td class="tabular-nums" [attr.data-label]="i18n.t('mgr.colEnd')">
                      @if (w.presence === 'WORKING') {
                        <span class="muted">{{ i18n.t('day.stillWorking') }}</span>
                      } @else {
                        {{ w.shiftEndedAt ? i18n.time(w.shiftEndedAt) : i18n.t('common.none') }}
                      }
                    </td>
                    <td class="tabular-nums" [attr.data-label]="i18n.t('mgr.colHours')">{{ w.minutesToday > 0 ? formatDuration(w.minutesToday) : i18n.t('common.none') }}</td>
                    <td [attr.data-label]="i18n.t('mgr.colSummary')">
                      @if (w.summaryId && w.summaryStatus) {
                        <button type="button" class="inline-flex items-center gap-1" [attr.aria-label]="i18n.t('mgr.openReport', { name: w.user.displayName })" (click)="openReport(w.summaryId)">
                          <aon-report-status [status]="statusOf(w.summaryStatus)" /><aon-icon name="chevron-right" [size]="16" />
                        </button>
                      } @else {
                        <span class="muted">{{ i18n.t('common.none') }}</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="empty">
                      <p>{{ i18n.t('mgr.noWorkers') }}</p>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (!data() && store.state() === 'LOADING') {
          <div class="card skeleton" aria-busy="true">
            @for (i of [1, 2, 3, 4]; track i) {
              <div class="skel-row"></div>
            }
            <span class="sr-only">{{ i18n.t('common.loading') }}</span>
          </div>
        }
      </div>

      @if (panel() && !docked()) {
        <div class="scrim" aria-hidden="true" (click)="closePanel()"></div>
      }
      @if (panel(); as p) {
        <aside class="inspector" role="region" aria-labelledby="drill-title">
          @if (p.kind === 'order') {
            @for (id of [p.id]; track id) {
              <aon-order-drill class="swap" [orderId]="id" [code]="selectedCode()" (closed)="closePanel()" (openReport)="openReport($event)" />
            }
          } @else {
            <aon-report-review [summaryId]="p.id" (closed)="closePanel()" />
          }
        </aside>
      }
    </div>
  `,
  styles: `
    .day-note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.6rem;
      margin: 0 0 0.75rem;
      padding: 0.55rem 0.8rem;
      border-radius: 0.6rem;
      background: var(--color-gold-tint);
      font-size: 0.9rem;
      line-height: 1.35;
    }
    .day-note > span {
      flex: 1 1 14rem;
    }
    .day-today {
      min-height: 2.25rem;
      padding: 0 0.8rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: #fff;
      font-weight: 600;
    }
    :host {
      display: block;
      --insp-w: 20.7rem;
    }
    .page {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      min-height: 100dvh;
    }
    .work {
      min-width: 0;
      padding: 0.8rem 2.5rem 2rem;
    }
    @media (min-width: 1360px) {
      .page.has-inspector {
        grid-template-columns: minmax(0, 1fr) var(--insp-w);
      }
      .page.has-inspector .work {
        padding-right: 0;
      }
    }
    .topline {
      display: flex;
      align-items: center;
    }
    .day {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      letter-spacing: -0.01em;
      height: 2.6rem;
      padding: 0 0.9rem;
      border: 1px solid var(--color-line);
      border-radius: 0.5rem;
      background: var(--color-panel);
      font-size: 1.13rem;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04);
    }
    .day:focus-within {
      border-color: var(--color-gold);
    }
    .day input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .titleline {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1rem;
      margin-top: 1.85rem;
    }
    .title {
      font-size: 2.09rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .title-scope {
      color: var(--color-text-muted);
      font-weight: 500;
    }
    .new {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      height: 2.5rem;
      margin-right: 0.25rem;
      padding: 0 1rem;
      border-radius: 0.5rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12), inset 0 -2px 0 rgb(0 0 0 / 0.08);
      transition: filter 160ms var(--ease-out-expo), transform 120ms var(--ease-out-expo);
    }
    .new:hover {
      filter: brightness(1.04);
    }
    .new:active {
      transform: translateY(1px);
      box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.15);
    }
    .search {
      position: relative;
      display: flex;
      align-items: center;
      height: 2.6rem;
      margin-top: 1.5rem;
      border: 1px solid var(--color-line);
      border-radius: 0.5rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04);
    }
    .search:focus-within {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.18);
    }
    .search-icon {
      margin-left: 0.85rem;
      color: var(--color-text-muted);
    }
    /* The shortcut hint only means something with a keyboard. */
    .kbd {
      display: none;
      margin-left: 0.7rem;
      color: var(--color-text-muted);
      font-family: var(--font-ui);
      font-size: 1.05rem;
    }
    @media (hover: hover) and (pointer: fine) and (min-width: 901px) {
      .kbd {
        display: inline;
      }
    }
    .search input {
      flex: 1 1 auto;
      min-width: 0;
      height: 100%;
      padding: 0 0.75rem 0 0.6rem;
      background: transparent;
      font-size: 1.13rem;
      outline: none;
    }
    .search input::placeholder {
      color: var(--color-text-muted);
    }
    .banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.9rem;
      padding: 0.65rem 0.9rem;
      border-radius: 0.5rem;
      background: var(--color-gold-fill);
      color: var(--color-gold-ink);
    }
    .banner-bad {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .banner-btn {
      margin-left: auto;
      min-height: 2.25rem;
      padding: 0 0.85rem;
      border-radius: 0.45rem;
      background: var(--color-text);
      color: #fff;
      font-weight: 500;
    }
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem 0.75rem;
      margin-top: 1.6rem;
    }
    .scope {
      display: flex;
      flex: 1 1 22rem;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.6rem;
      min-width: 0;
    }
    .scope-field {
      position: relative;
      display: flex;
      align-items: center;
      flex: 0 1 15rem;
      min-width: 0;
    }
    .scope-field select {
      width: 100%;
      height: 2.85rem;
      padding: 0 2.3rem 0 0.85rem;
      border: 1px solid var(--color-line);
      border-radius: 0.65rem;
      background: var(--color-panel);
      color: var(--color-text-muted);
      font-weight: 500;
      text-overflow: ellipsis;
      appearance: none;
      cursor: pointer;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04);
    }
    .scope-field select:focus-visible {
      border-color: var(--color-gold);
    }
    /* A chosen project or object is a filter in force: it reads as set, not as a placeholder. */
    .scope-field.is-set select {
      border-color: var(--color-gold);
      background: var(--color-gold-fill);
      color: var(--color-text);
      font-weight: 600;
    }
    .scope-field aon-icon {
      position: absolute;
      right: 0.8rem;
      color: var(--color-text-muted);
      pointer-events: none;
    }
    @media (max-width: 900px) {
      .scope {
        justify-content: stretch;
      }
      .scope-field {
        flex: 1 1 10rem;
      }
    }
    .card {
      margin-top: 1.6rem;
      border: 1px solid var(--color-line);
      border-radius: 0.6rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 8px 24px -18px rgb(20 20 20 / 0.25);
      overflow: auto;
    }
    @media (min-width: 1360px) {
      .page.has-inspector .card {
        border-right: 0;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
      }
    }
    .tbl {
      width: 100%;
      min-width: 46rem;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: 1.04rem;
      font-variant-numeric: tabular-nums;
    }
    .tbl-team {
      table-layout: auto;
      min-width: 0;
    }
    /* A narrow office screen scrolls the team table inside its card rather than hiding the last columns. */
    .card:has(> .tbl-team) {
      overflow-x: auto;
    }
    .tbl-team td {
      white-space: nowrap;
    }
    /* The object name may wrap so the report-state pill keeps its room. */
    .tbl-team td:nth-child(3) {
      white-space: normal;
      min-width: 9rem;
    }
    .tbl-team td:last-child {
      min-width: 11rem;
    }
    .codes {
      font-variant-numeric: normal;
      font-feature-settings: normal;
      letter-spacing: -0.01em;
    }
    .tbl thead tr {
      background: var(--color-row-tint);
    }
    .tbl thead th {
      padding: 0;
      background: var(--color-row-tint);
      border-bottom: 1px solid var(--color-line);
      text-align: left;
    }
    .th {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      height: 2.6rem;
      padding: 0 1rem;
      color: var(--color-text-muted);
      font-weight: 400;
      white-space: nowrap;
    }
    button.th:hover {
      color: var(--color-text);
    }
    .c-code {
      /* The code never wraps into the title on a narrower office screen. */
      width: max(12%, 8.75rem);
      padding-right: 1.5rem !important;
    }
    .c-title {
      width: 23%;
    }
    .c-where {
      width: 18%;
    }
    .where {
      display: grid;
      min-width: 0;
      line-height: 1.25;
    }
    .where-p,
    .where-s {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .where-p {
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    .where-inline {
      display: none;
      overflow: hidden;
      margin-top: 0.15rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Narrower screens: where moves under the title, so the names and progress keep their room. */
    @media (max-width: 1280px) {
      .tbl .c-where {
        display: none;
      }
      .where-inline {
        display: block;
      }
      .c-code {
        width: max(14.5%, 8.75rem);
      }
      .c-title {
        width: 27%;
      }
      .c-worker {
        width: 25%;
      }
      .c-status {
        width: 14.5%;
      }
      .tbl {
        min-width: 38rem;
      }
    }
    .c-worker {
      width: 19%;
      white-space: nowrap;
    }
    .c-worker .clamp {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .c-status {
      width: 12%;
    }
    .row td {
      height: 4.35rem;
      padding: 0.4rem 1rem;
      border-bottom: 1px solid var(--color-line);
      vertical-align: middle;
    }
    .row:last-child td {
      border-bottom: 0;
    }
    .row {
      cursor: pointer;
      transition: background-color 180ms var(--ease-out-expo), box-shadow 180ms var(--ease-out-expo);
    }
    .row.is-static {
      cursor: default;
    }
    .row:not(.is-open):not(.is-static):hover {
      background: var(--color-row-tint);
    }
    .row.is-open {
      background: var(--color-gold-fill);
      box-shadow: inset 0 0 0 2px var(--color-gold);
    }
    .row:focus-within:not(.is-static) {
      box-shadow: inset 0 0 0 2px var(--color-charcoal);
    }
    .row .code:focus-visible {
      outline: none;
      box-shadow: none;
    }
    .pg:focus-visible {
      position: relative;
      z-index: 1;
      outline: 2px solid var(--color-charcoal);
      outline-offset: 2px;
      box-shadow: 0 0 0 5px rgb(193 160 80 / 0.45);
    }
    .code {
      white-space: nowrap;
      font-variant-numeric: normal;
      font-feature-settings: normal;
      letter-spacing: -0.01em;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 0.2em;
    }
    .code:hover {
      text-decoration-color: currentColor;
    }
    .clamp {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.25;
    }
    .muted {
      color: var(--color-text-muted);
    }
    .who {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .ava {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      flex: 0 0 auto;
      border-radius: 9999px;
      background: #5d6f93;
      color: #fff;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .ava[data-tone='1'] {
      background: #b9984a;
    }
    .ava[data-tone='2'] {
      background: #a85a55;
    }
    .ava[data-tone='3'] {
      background: #4f7a72;
    }
    .ava[data-tone='4'] {
      background: #7b6a94;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 1.85rem;
      padding: 0 0.6rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text);
      font-size: 1.05rem;
      white-space: nowrap;
    }
    .badge[data-s='NEW'],
    .badge[data-p='NOT_STARTED'] {
      background: var(--color-new-tint);
      color: var(--color-new-ink);
    }
    .badge[data-s='IN_PROGRESS'],
    .badge[data-p='WORKING'] {
      background: var(--color-blue-tint);
      color: var(--color-blue);
    }
    .badge[data-s='COMPLETED'],
    .badge[data-p='FINISHED'] {
      background: var(--color-ok-tint);
      color: var(--color-ok-ink);
    }
    .badge[data-s='ISSUE'] {
      background: var(--color-bad-tint);
      color: var(--color-bad);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .badge-wait {
      background: transparent;
      box-shadow: inset 0 0 0 1px var(--color-line-strong);
      color: var(--color-text-muted);
    }
    .prog {
      display: inline-grid;
      gap: 0.35rem;
    }
    .prog-bar {
      display: block;
      width: 6rem;
      height: 0.36rem;
      border-radius: 9999px;
      background: var(--color-track);
      overflow: hidden;
    }
    .prog-bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-progress);
    }
    .pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: 1rem;
      padding-right: 1rem;
    }
    .pager-info {
      color: var(--color-text-muted);
      font-size: 1rem;
    }
    .pager-btns {
      display: flex;
      gap: 0.35rem;
    }
    .pg {
      display: grid;
      place-items: center;
      min-width: 2.4rem;
      height: 2.4rem;
      padding: 0 0.5rem;
      border: 1px solid var(--color-line);
      border-radius: 0.45rem;
      background: var(--color-panel);
      font-variant-numeric: tabular-nums;
    }
    .pg:hover:not(:disabled) {
      border-color: var(--color-line-strong);
    }
    .pg:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .pg.is-on {
      border-color: var(--color-text);
      background: var(--color-text);
      color: #fff;
    }
    .empty {
      padding: 2.5rem 1rem;
      text-align: center;
      color: var(--color-text-muted);
    }
    .empty-btn {
      margin-top: 0.75rem;
      min-height: 2.5rem;
      padding: 0 1rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      color: var(--color-text);
      font-weight: 500;
    }
    .skeleton {
      display: grid;
      gap: 0.5rem;
      padding: 1rem;
    }
    .skel-row {
      height: 3rem;
      border-radius: 0.4rem;
      background: linear-gradient(90deg, var(--color-field), #faf9f6, var(--color-field));
      background-size: 200% 100%;
      animation: skel 1.4s linear infinite;
    }
    @keyframes skel {
      to {
        background-position: -200% 0;
      }
    }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 45;
      background: rgb(42 41 41 / 0.4);
      animation: scrim-in 200ms var(--ease-out-expo) both;
    }
    @keyframes scrim-in {
      from {
        opacity: 0;
      }
    }
    @media (max-width: 600px) {
      .inspector {
        width: 100vw !important;
      }
    }
    .inspector {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 50;
      width: min(var(--insp-w), 100vw);
      overflow-y: auto;
      border-left: 1px solid var(--color-line);
      background: var(--color-panel);
      box-shadow: -18px 0 40px -24px rgb(20 20 20 / 0.3);
      animation: insp-in 260ms var(--ease-out-expo) both;
    }
    @media (min-width: 1360px) {
      .inspector {
        position: sticky;
        width: auto;
        height: 100dvh;
        z-index: 2;
      }
    }
    /* Selecting another row swaps the inspector's content in place: a short lift, no slide of the whole panel. */
    .swap {
      animation: swap-in 220ms var(--ease-out-expo) both;
    }
    @keyframes swap-in {
      from {
        opacity: 0;
        transform: translateY(0.4rem);
      }
    }
    @keyframes insp-in {
      from {
        transform: translateX(1rem);
        opacity: 0;
      }
    }
    /* Phones: each order becomes a card, so nothing hides behind a sideways scroll. */
    @media (max-width: 700px) {
      .card:not(.skeleton) .tbl {
        min-width: 0;
        table-layout: auto;
      }
      .tbl thead {
        display: none;
      }
      .tbl tbody,
      .tbl tr {
        display: block;
      }
      .row {
        display: grid !important;
        grid-template-columns: 1fr auto;
        gap: 0.35rem 0.75rem;
        padding: 0.85rem 0.9rem;
        border-bottom: 1px solid var(--color-line);
      }
      .row td {
        display: block;
        width: auto !important;
        height: auto;
        padding: 0 !important;
        border: 0;
      }
      .row .c-code {
        font-weight: 600;
      }
      .row .c-status {
        grid-column: 2;
        grid-row: 1;
        justify-self: end;
      }
      .row .c-title {
        grid-column: 1 / -1;
      }
      /* Who and how far share the last line, so a phone shows twice as many orders per screen. */
      .row .c-worker {
        grid-column: 1;
        min-width: 0;
      }
      .row .c-progress {
        grid-column: 2;
        justify-self: end;
        align-self: center;
        text-align: right;
      }
      .row .c-progress .prog-bar {
        width: 4.5rem;
        margin-left: auto;
      }
      .row.is-static td[data-label] > * {
        text-align: right;
      }
      .row.is-static td {
        grid-column: 1 / -1;
      }
      .row.is-static td[data-label] {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
      }
      .row.is-static td[data-label]::before {
        content: attr(data-label);
        color: var(--color-text-muted);
      }
    }
    @media (max-width: 900px) {
      .work {
        padding: 0.75rem 0.9rem 1.5rem;
      }
      .title {
        font-size: 1.6rem;
      }
    }
  `,
})
export class OverviewComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ManagerStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly formatDuration = formatDuration;
  protected readonly today = toIsoDate();

  /** `?order=` opens an order; `?view=workers` shows the team; `?review=next` the next report; `?project=` / `?site=` scope the list. */
  readonly order = input<string | undefined>(undefined);
  readonly view = input<'orders' | 'workers', string | undefined>('orders', { transform: (v) => (v === 'workers' ? 'workers' : 'orders') });
  readonly review = input<string | undefined>(undefined);
  readonly report = input<string | undefined>(undefined);
  readonly project = input<string | undefined>(undefined);
  readonly site = input<string | undefined>(undefined);

  protected readonly status = signal<StatusTab>('ALL');
  protected readonly sort = signal<{ key: SortKey; dir: 1 | -1 }>({ key: 'code', dir: 1 });
  protected readonly panel = signal<Panel | null>(null);
  private readonly docked = signal(false);
  /** The manager closed the inspector on purpose; do not reopen it on the next data refresh. */
  private userClosed = false;

  protected readonly tabs: ReadonlyArray<{ id: StatusTab; label: TranslationKey }> = [
    { id: 'ALL', label: 'mgr.tabAll' },
    { id: 'NEW', label: 'status.NEW' },
    { id: 'IN_PROGRESS', label: 'status.IN_PROGRESS' },
    { id: 'COMPLETED', label: 'status.COMPLETED' },
    { id: 'ISSUE', label: 'status.ISSUE' },
  ];
  protected readonly cols: ReadonlyArray<{ key: SortKey; label: TranslationKey }> = [
    { key: 'code', label: 'mgr.colId' },
    { key: 'title', label: 'mgr.colTitle' },
    { key: 'where', label: 'mgr.colWhere' },
    { key: 'worker', label: 'mgr.colOwner' },
    { key: 'status', label: 'mgr.colStatus' },
    { key: 'progress', label: 'mgr.colProgress' },
  ];
  protected readonly workerCols: readonly TranslationKey[] = [
    'mgr.colWorker',
    'mgr.colPresence',
    'mgr.colSite',
    'mgr.colActive',
    'mgr.colSince',
    'mgr.colEnd',
    'mgr.colHours',
    'mgr.colSummary',
  ];

  protected readonly data = this.store.overview;

  /** What the page lists: orders, the team, or the day's reports (`?review=`). */
  protected readonly mode = computed<'orders' | 'workers' | 'reviews'>(() => (this.review() ? 'reviews' : this.view()));

  /** The day's daily reports, the ones waiting for a decision first. */
  protected readonly reportRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const names = new Map(d.workers.map((w) => [w.user.id, w.user.displayName]));
    const rank: Readonly<Record<DailySummaryStatus, number>> = { SUBMITTED: 0, RETURNED: 1, DRAFT: 2, APPROVED: 3 };
    const words = this.words();
    const site = this.site();
    const project = this.project();
    const orderById = new Map(d.orders.map((o) => [o.order.id, o.order]));
    // A report is in scope when any order the worker worked on that day is.
    const inScope = (s: DailySummary): boolean =>
      (!site && !project) ||
      s.lines.some((l) => {
        const o = orderById.get(l.workOrderId);
        return !!o && (site ? o.siteId === site : o.projectId === project);
      });
    return [...d.summaries]
      .filter(inScope)
      .map((s) => ({
        id: s.id,
        name: names.get(s.userId) ?? s.userId,
        arrival: this.i18n.time(s.arrivalAt),
        departure: this.i18n.time(s.departureAt),
        hours: formatDuration(s.shiftMinutes),
        orders: s.ordersWorked.join(', ') || this.i18n.t('common.none'),
        status: s.status,
      }))
      .filter((r) => words.every((w) => `${r.name} ${r.orders}`.toLocaleLowerCase().includes(w)))
      .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  });

  protected readonly dayLabel = computed(() =>
    this.store.isToday() ? this.i18n.t('mgr.dayToday', { date: this.i18n.dateShort(this.store.date()) }) : this.i18n.date(this.store.date()),
  );

  protected readonly cachedAt = computed(() => {
    const at = this.store.savedAt();
    return at ? `${this.i18n.date(at)} ${this.i18n.time(at)}` : '';
  });

  private readonly siteById = computed(() => new Map((this.data()?.sites ?? []).map((s) => [s.id, s])));

  protected readonly scopeName = computed(() => {
    const site = this.site();
    if (site) return this.siteById().get(site)?.name ?? '';
    const project = this.project();
    if (project) return this.data()?.projects.find((p) => p.id === project)?.name ?? '';
    return '';
  });

  /** The project the list is scoped to: the chosen one, or the one an object in scope belongs to. */
  protected readonly scopeProjectId = computed(() => {
    const site = this.site();
    return site ? (this.siteById().get(site)?.projectId ?? '') : (this.project() ?? '');
  });

  /** Projects that have objects, by name, for the project picker. */
  protected readonly scopeProjects = computed(() => {
    const withSites = new Set((this.data()?.sites ?? []).map((s) => s.projectId));
    return (this.data()?.projects ?? []).filter((p) => withSites.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, this.i18n.locale()));
  });

  /** The object picker: the chosen project's objects, or every object grouped by project. */
  protected readonly scopeSiteGroups = computed(() => {
    const project = this.scopeProjectId();
    const sites = this.data()?.sites ?? [];
    return this.scopeProjects()
      .filter((p) => !project || p.id === project)
      .map((p) => ({ project: p, sites: sites.filter((s) => s.projectId === p.id).sort((a, b) => a.name.localeCompare(b.name, this.i18n.locale(), { numeric: true })) }));
  });

  /** Server rows, with orders saved on this device laid over them until the server confirms. */
  private readonly allRows = computed<readonly OrderRow[]>(() => {
    const server = this.data()?.orders ?? [];
    const pending = this.store.authored();
    const names = new Map<string, string>();
    for (const w of this.data()?.workers ?? []) names.set(w.user.id, w.user.displayName);
    for (const w of this.store.directory()?.workers ?? []) names.set(w.user.id, w.user.displayName);
    const pendingById = new Map(pending.map((p) => [p.id, p]));
    const projectNames = new Map((this.data()?.projects ?? []).map((p) => [p.id, p.name]));
    // Project and object apart, from the lists; the denormalised "Projekt · Objekt" covers anything not loaded.
    const where = (o: { projectId: string; siteId: string; siteName: string }): { projectName: string; siteLabel: string } => {
      const [project = '', ...rest] = o.siteName.split(' · ');
      return { projectName: projectNames.get(o.projectId) ?? project, siteLabel: this.siteById().get(o.siteId)?.name ?? (rest.join(' · ') || project) };
    };
    const rows: OrderRow[] = server.map((r) => {
      const local = pendingById.get(r.order.id);
      const order = local
        ? { ...r.order, title: local.title, location: local.location, crew: local.crewIds.map((id) => ({ id, displayName: names.get(id) ?? id })), published: local.published || r.order.published, plannedQty: local.plannedQty, unit: local.unit }
        : r.order;
      return { ...r, order, pending: !!local, crewNames: order.crew.map((c) => c.displayName), ...where(order) };
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
        activeOnDate: p.date === this.store.date() || p.dueDate === this.store.date(),
        pending: true,
        crewNames,
        projectName: site?.projectName ?? '',
        siteLabel: site?.name ?? '',
      });
    }
    return rows;
  });

  private readonly words = computed(() => this.store.query().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean));

  /**
   * Rows inside the project or object scope that match the search, before the status filter. Today shows the
   * whole working list (every open order); any other day only the orders that concern that day.
   */
  private readonly scopedRows = computed(() => {
    const site = this.site();
    const project = this.project();
    const words = this.words();
    const pastDay = !this.store.isToday();
    return this.allRows().filter((r) => {
      if (pastDay && !r.activeOnDate) return false;
      if (site && r.order.siteId !== site) return false;
      if (!site && project && r.order.projectId !== project) return false;
      const hay = `${r.order.code ?? ''} ${r.order.title} ${r.crewNames.join(' ')} ${r.order.location} ${r.order.siteName}`.toLocaleLowerCase();
      return words.every((w) => hay.includes(w));
    });
  });

  protected readonly counts = computed<Readonly<Record<StatusTab, number>>>(() => {
    const rows = this.scopedRows();
    const by = (s: WorkOrderStatus): number => rows.filter((r) => r.order.published && !r.pending && r.order.status === s).length;
    return { ALL: rows.length, NEW: by('NEW'), IN_PROGRESS: by('IN_PROGRESS'), COMPLETED: by('COMPLETED'), ISSUE: by('ISSUE') };
  });

  protected readonly orderRows = computed(() => {
    const status = this.status();
    const { key, dir } = this.sort();
    const rows = this.scopedRows().filter((r) => status === 'ALL' || (!r.pending && r.order.published && r.order.status === status));
    const value = (r: OrderRow): number | string => {
      switch (key) {
        case 'code':
          return r.order.code ?? '';
        case 'title':
          return r.order.title;
        case 'where':
          return `${r.projectName} ${r.siteLabel}`;
        case 'worker':
          return r.crewNames[0] ?? '￿';
        case 'status':
          return r.pending ? -2 : !r.order.published ? -1 : STATUS_RANK[r.order.status];
        case 'progress':
          return this.progress(r);
      }
    };
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), this.i18n.locale(), { numeric: true });
      return c * dir || compareCodes(a.order.code, b.order.code);
    });
  });

  protected readonly page = signal(0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.orderRows().length / PAGE_SIZE)));
  protected readonly pages = computed(() => Array.from({ length: this.pageCount() }, (_, i) => i));
  protected readonly pageRows = computed(() => {
    const p = Math.min(this.page(), this.pageCount() - 1);
    return this.orderRows().slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  });
  protected readonly pageFrom = computed(() => Math.min(this.orderRows().length, Math.min(this.page(), this.pageCount() - 1) * PAGE_SIZE + 1));
  protected readonly pageTo = computed(() => Math.min(this.orderRows().length, (Math.min(this.page(), this.pageCount() - 1) + 1) * PAGE_SIZE));

  protected readonly workerRows = computed(() => {
    const words = this.words();
    const site = this.site();
    const project = this.project();
    return (this.data()?.workers ?? [])
      .filter((w: WorkerOverview) => {
        if (site && w.site?.id !== site) return false;
        if (!site && project && w.site?.projectId !== project) return false;
        const hay = `${w.user.displayName} ${w.user.crew ?? ''} ${w.activeOrderCode ?? ''}`.toLocaleLowerCase();
        return words.every((x) => hay.includes(x));
      })
      .sort((a, b) => PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence] || a.user.displayName.localeCompare(b.user.displayName));
  });

  protected readonly selectedCode = computed(() => {
    const p = this.panel();
    return p?.kind === 'order' ? (this.allRows().find((o) => o.order.id === p.id)?.order.code ?? '') : '';
  });

  constructor() {
    // A new filter, search, sort or scope starts again at the first page.
    effect(() => {
      this.status();
      this.sort();
      this.words();
      this.site();
      this.project();
      untracked(() => this.page.set(0));
    });
    // The team view needs the full width for its columns: an order left open from the orders view closes.
    effect(() => {
      if (this.mode() !== 'workers') return;
      untracked(() => {
        if (this.panel()?.kind === 'order') this.panel.set(null);
      });
    });
    // `?review=next` opens the oldest report waiting for a decision once the day has loaded.
    effect(() => {
      if (this.review() !== 'next') return;
      const next = this.store.toReview()[0];
      if (next) untracked(() => this.panel.set({ kind: 'report', id: next.id }));
    });
    // A linked order (`?order=`) opens on its own page.
    effect(() => {
      const id = this.order();
      if (id) untracked(() => void this.router.navigate(['/m/orders', id], { replaceUrl: true }));
    });
    // A linked daily report (`?report=`) opens in the panel.
    effect(() => {
      const id = this.report();
      if (id) untracked(() => this.panel.set({ kind: 'report', id }));
    });
  }

  ngOnInit(): void {
    void this.store.load();
    void this.store.loadDirectory();

    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(min-width: 1360px)');
      this.docked.set(mq.matches);
      const onChange = (e: MediaQueryListEvent): void => this.docked.set(e.matches);
      mq.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
    }
    // Keep the day's picture fresh while the office has signal. A tiny "anything new?" every 4 s reloads the
    // day only when a worker's entry has arrived; a full reload every minute and on return to the window
    // catches the rest (e.g. a day that rolled over).
    const visible = (): boolean => document.visibilityState === 'visible';
    const check = setInterval(() => visible() && void this.store.checkForChanges(), 4_000);
    const full = setInterval(() => visible() && this.store.state() !== 'LOADING' && void this.store.load(), 60_000);
    const onVisible = (): void => {
      if (visible() && this.store.state() !== 'LOADING') void this.store.load();
    };
    document.addEventListener('visibilitychange', onVisible);
    this.destroyRef.onDestroy(() => {
      clearInterval(check);
      clearInterval(full);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  /** ⌘K / Ctrl+K focuses the search, as the hint in the field promises. */
  protected onKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.searchEl()?.nativeElement.focus();
    }
  }

  protected toToday(): void {
    this.panel.set(null);
    this.store.setDate(toIsoDate());
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

  /** Server rows open the order's page; an order still on its way can only be edited. */
  protected openRow(row: OrderRow): void {
    if (row.pending && !this.data()?.orders.some((o) => o.order.id === row.order.id)) {
      void this.router.navigate(['/m/orders', row.order.id, 'edit']);
      return;
    }
    void this.router.navigate(['/m/orders', row.order.id]);
  }

  protected closePanel(): void {
    this.userClosed = true;
    this.panel.set(null);
    if (this.review()) void this.router.navigate(['/m']);
  }

  protected openReport(id: string): void {
    this.panel.set({ kind: 'report', id });
  }

  protected selectByCode(code: string): void {
    const row = this.data()?.orders.find((o) => o.order.code === code);
    if (row) void this.router.navigate(['/m'], { queryParams: { order: row.order.id } });
  }

  /** The scope lives in the URL, so the sidebar tree marks the same project or object; the view stays as it is. */
  protected pickProject(id: string): void {
    this.scopeTo(id ? { project: id } : {});
  }

  protected pickSite(id: string): void {
    const project = this.scopeProjectId();
    this.scopeTo(id ? { site: id } : project ? { project } : {});
  }

  private scopeTo(scope: { project?: string; site?: string }): void {
    const view = this.mode() === 'workers' ? { view: 'workers' } : {};
    const review = this.review();
    void this.router.navigate(['/m'], { queryParams: { ...view, ...(review ? { review } : {}), ...scope } });
  }

  protected clearFilters(): void {
    this.status.set('ALL');
    this.store.query.set('');
    if (this.site() || this.project()) void this.router.navigate(['/m']);
  }

  protected crew(names: readonly string[]): string {
    return names.length > 1 ? `${names[0] ?? ''} +${names.length - 1}` : (names[0] ?? '');
  }

  protected initials(name: string | undefined): string {
    return initialsOf(name ?? '');
  }

  protected tone(name: string | undefined): number {
    return avatarTone(name ?? '');
  }

  protected progress(r: OrderOverview): number {
    return progressRatio(r.order.doneQty, r.order.plannedQty);
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected statusKey(status: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${status}`;
  }

  protected presenceKey(p: WorkerPresence): TranslationKey {
    return `mgr.presence.${p}`;
  }

  protected statusOf(s: DailySummaryStatus): DailySummaryStatus {
    return s;
  }
}
