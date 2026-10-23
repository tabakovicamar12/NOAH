import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmDeleteComponent } from '../../shared/ui/confirm-delete.component';
import { OrgService } from '../../core/org/org.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { ApiError, type PhotoView, type WorkOrderDetailResponse } from '../../core/models/api.models';
import { PHOTO_CATEGORIES, type LogEntry, type PhotoCategory, type TimeEntry, type WorkOrderStatus } from '../../core/models/domain.models';
import { ClockService } from '../../core/ui/clock.service';
import { minutesBetween, toIsoDate } from '../../core/util/util';
import { hm } from '../../core/worktime/worktime';
import { IconComponent } from '../../shared/ui/icon.component';
import type { IconName } from '../../shared/ui/icon.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { ManagerStore } from './data/manager-store.service';
import { avatarTone, initialsOf } from './person';

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: WorkOrderDetailResponse };

/** One line of the order's history: who did what, when. */
interface OrderEvent {
  readonly at: number;
  readonly kind: 'start' | 'stop' | 'qty' | 'fix' | 'note' | 'issue' | 'photo';
  readonly userId: string;
  readonly text: string | null;
  readonly figure: string | null;
  readonly photo: PhotoView | null;
}

interface Day {
  readonly date: string;
  readonly events: readonly OrderEvent[];
}

const PHOTO_ICON: Readonly<Record<PhotoCategory, IconName>> = { BEFORE: 'camera', IN_PROGRESS: 'timer', FINISHED: 'circle-check', ISSUE: 'alert' };

/**
 * Delovni nalog, full page for the desk: the order as a site document. The head names the number, the job and
 * where it stands; the facts read like the paper order; progress shows quantity and hours against plan; the
 * history interleaves every quantity, note, problem, photo and timer by day; photos sit by what they document.
 * Prints as an A4 work order.
 */
@Component({
  selector: 'aon-order-page',
  imports: [RouterLink, NgTemplateOutlet, ConfirmDeleteComponent, IconComponent, LogoComponent, ReportStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'openPhoto.set(null); crewOpen.set(false)',
    '(document:keydown.arrowleft)': 'stepPhoto(-1)',
    '(document:keydown.arrowright)': 'stepPhoto(1)',
  },
  template: `
    <div class="op">
      <nav class="bar no-print" [attr.aria-label]="i18n.t('op.nav')">
        <a routerLink="/m" class="back"><aon-icon name="arrow-left" [size]="18" [stroke]="2" />{{ i18n.t('mgr.navOrders') }}</a>
        @if (data(); as d) {
          <div class="tools">
            <a class="tool" [routerLink]="['/m/orders', d.order.id, 'edit']"><aon-icon name="pencil" [size]="17" />{{ i18n.t('drill.edit') }}</a>
            <a class="tool" routerLink="/m/orders/new" [queryParams]="{ from: d.order.id }"><aon-icon name="copy" [size]="17" />{{ i18n.t('drill.duplicate') }}</a>
            @if (isAdmin()) {
              <button type="button" class="tool is-danger" (click)="askDelete()"><aon-icon name="trash" [size]="17" />{{ i18n.t('op.delete') }}</button>
            }
            <button type="button" class="tool is-main" (click)="print()"><aon-icon name="printer" [size]="17" />{{ i18n.t('op.print') }}</button>
          </div>
          @if (deleting()) {
            <aon-confirm-delete
              [heading]="i18n.t('op.deleteTitle', { code: d.order.code ?? d.order.title })"
              [points]="[i18n.t('op.deleteWhat'), i18n.t('op.deleteOnlyEmpty'), i18n.t('delete.irreversible')]"
              [confirmLabel]="i18n.t('op.deleteConfirm')"
              [busy]="deleteBusy()"
              [error]="deleteError()"
              (confirmed)="confirmDelete()"
              (cancelled)="deleting.set(false)"
            />
          }
        }
      </nav>

      @switch (state().kind) {
        @case ('LOADING') {
          <div class="skel" aria-busy="true"><span class="sr-only">{{ i18n.t('common.loading') }}</span></div>
        }
        @case ('ERROR') {
          <p class="err" role="alert">
            <aon-icon name="alert" [size]="18" />{{ i18n.t('drill.loadFailed') }}
            <button type="button" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </p>
        }
        @case ('READY') {
          @if (data(); as d) {
            @let o = d.order;
            <!-- Head: number and job, where it stands, and the drawing of the site behind it. -->
            <header class="head">
              <img class="head-art no-print" src="/plates/home-drawing.jpg" alt="" width="1024" height="688" decoding="async" />
              <div class="head-in">
                <h1 class="h1">
                  <span class="h1-no">{{ i18n.t('order.numberLabel', { code: o.code ?? '–' }) }}</span>
                  <span class="h1-title">{{ o.title }}</span>
                </h1>
                <p class="where">
                  <aon-icon name="pin" [size]="16" />{{ o.siteName }}@if (o.location) {<span class="dot">·</span>{{ o.location }}}
                </p>
                <div class="head-tags">
                  <span class="status" [attr.data-s]="o.status">{{ i18n.t(statusKey(o.status)) }}</span>
                  @if (!o.published) {
                    <span class="tag">{{ i18n.t('mgr.draftShort') }}</span>
                  }
                  @if (isLate()) {
                    <span class="tag is-bad"><aon-icon name="clock" [size]="14" />{{ i18n.t('op.late') }}</span>
                  }
                </div>
              </div>
              <ol class="path" [attr.aria-label]="i18n.t('drill.status')">
                @for (s of steps; track s; let i = $index) {
                  <li [class.is-done]="i < step()" [class.is-now]="i === step()" [class.is-bad]="i === 1 && o.status === 'ISSUE'">
                    <span class="path-dot" aria-hidden="true">
                      @if (i < step()) {
                        <aon-icon name="check" [size]="13" [stroke]="3" />
                      } @else if (i === 1 && o.status === 'ISSUE') {
                        <aon-icon name="alert" [size]="13" [stroke]="2.5" />
                      }
                    </span>
                    <span class="path-l">{{ i === 1 && o.status === 'ISSUE' ? i18n.t('status.ISSUE') : i18n.t(statusKey(s)) }}</span>
                  </li>
                }
              </ol>
            </header>

            <!-- The facts of the order, laid out like the paper form. -->
            <dl class="facts">
              <div><dt>{{ i18n.t('op.project') }}</dt><dd>{{ projectName() }}</dd></div>
              <div><dt>{{ i18n.t('drill.manager') }}</dt><dd>{{ o.managerName || '–' }}</dd></div>
              <div class="crew">
                <dt>{{ i18n.t('drill.crew') }}</dt>
                <dd>
                  @if (o.crew.length) {
                    <div class="stack">
                      <span class="avs" aria-hidden="true">
                        @for (c of o.crew.slice(0, 4); track c.id) {
                          <span class="ava" [attr.data-tone]="tone(c.displayName)" [title]="c.displayName">{{ initials(c.displayName) }}</span>
                        }
                        @if (o.crew.length > 4) {
                          <span class="ava is-more">+{{ o.crew.length - 4 }}</span>
                        }
                      </span>
                      <span class="names">
                        {{ crewLead(o.crew) }}
                        @if (o.crew.length > 2) {
                          <small>{{ i18n.t('op.crewCount', { n: o.crew.length }) }}</small>
                        }
                      </span>
                    </div>
                    @if (o.crew.length > 2) {
                      <button type="button" class="toggle" [attr.aria-expanded]="crewOpen()" (click)="crewOpen.set(!crewOpen())">{{ crewOpen() ? i18n.t('op.less') : i18n.t('op.crewAll') }}</button>
                      @if (crewOpen()) {
                        <ul class="all">
                          @for (c of o.crew; track c.id) {
                            <li>{{ c.displayName }}</li>
                          }
                        </ul>
                      }
                    }
                  } @else {
                    <span class="muted">{{ i18n.t('mgr.unassigned') }}</span>
                  }
                </dd>
              </div>
              <div><dt>{{ i18n.t('op.date') }}</dt><dd class="num">{{ o.date ? i18n.dateShort(o.date) : "–" }}</dd></div>
              <div><dt>{{ i18n.t('drill.due') }}</dt><dd class="num" [class.bad]="isLate()">{{ o.dueDate ? i18n.dateShort(o.dueDate) : "–" }}</dd></div>
              <div><dt>{{ i18n.t('op.estimate') }}</dt><dd class="num">{{ o.estimatedMinutes ? hours(o.estimatedMinutes) : '–' }}</dd></div>
            </dl>

            <!-- Progress: the quantity and the hours, each against its plan. -->
            <section class="progress" [attr.aria-label]="i18n.t('op.progress')">
              <button type="button" class="meter" [attr.aria-label]="i18n.t('op.goQty')" (click)="go('qty')">
                <div class="m-top">
                  <span class="m-k">{{ i18n.t('drill.qty') }}</span>
                  @if (o.plannedQty > 0) {
                    <span class="m-v num">{{ i18n.number(o.doneQty) }}<span class="m-of"> / {{ i18n.number(o.plannedQty) }} {{ unitLabel() }}</span></span>
                  } @else {
                    <span class="m-v">{{ i18n.t('order.noQuantity') }}</span>
                  }
                </div>
                @if (o.plannedQty > 0) {
                  <span class="bar-t" aria-hidden="true"><span [style.width.%]="qtyRatio() * 100"></span></span>
                  <span class="m-s">{{ i18n.t('op.percent', { n: pct(qtyRatio()) }) }}@if (o.doneQty > o.plannedQty) { · {{ i18n.t('op.overPlan') }}}</span>
                } @else {
                  <span class="m-s">{{ i18n.t('order.noQuantityDone') }}</span>
                }
              </button>
              <button type="button" class="meter" [class.is-over]="hoursOver()" [attr.aria-label]="i18n.t('op.goTime')" (click)="go('time')">
                <div class="m-top">
                  <span class="m-k">{{ i18n.t('drill.hoursUsed') }}</span>
                  <span class="m-v num">{{ hm(totalMinutes()) }} h@if (o.estimatedMinutes) {<span class="m-of"> / {{ hm(o.estimatedMinutes) }} h</span>}</span>
                </div>
                <span class="bar-t" aria-hidden="true"><span [style.width.%]="timeRatio() * 100"></span></span>
                <span class="m-s">
                  @if (running().length) {
                    <span class="live"></span>{{ i18n.t('op.runningNow', { names: running().join(', ') }) }}
                  } @else if (hoursOver()) {
                    {{ i18n.t('op.hoursOver') }}
                  } @else {
                    {{ i18n.t('op.byWorkers', { n: perWorker().length }) }}
                  }
                </span>
              </button>
              <button type="button" class="meter is-small" [attr.aria-label]="i18n.t('op.goPhotos')" (click)="go('photos')">
                <span class="m-k">{{ i18n.t('drill.photos') }}</span>
                <span class="m-v num">{{ d.photos.length }}</span>
              </button>
              <button type="button" class="meter is-small" [class.is-bad]="issues().length > 0" [attr.aria-label]="i18n.t('op.goIssues')" (click)="go('issues')">
                <span class="m-k">{{ i18n.t('drill.issues') }}</span>
                <span class="m-v num">{{ issues().length }}</span>
              </button>
            </section>

            <div class="cols">
              <ng-template #evTpl let-e>
                <li class="ev" [attr.data-k]="e.kind">
                  <span class="ev-time num">{{ i18n.time(e.at) }}</span>
                  <span class="ev-ico" aria-hidden="true"><aon-icon [name]="eventIcon(e.kind)" [size]="14" [stroke]="2.25" /></span>
                  <div class="ev-body">
                    <p class="ev-line"><b>{{ workerName(e.userId) }}</b> {{ eventLabel(e) }}@if (e.figure) { <span class="ev-fig num">{{ e.figure }}</span>}</p>
                    @if (e.text) {
                      <p class="ev-text clamp" [class.is-open]="openTexts().has(e.at + e.kind)">{{ e.text }}</p>
                      @if (e.text.length > 160) {
                        <button type="button" class="more-link" (click)="toggleText(e.at + e.kind)">{{ openTexts().has(e.at + e.kind) ? i18n.t('op.less') : i18n.t('op.more') }}</button>
                      }
                    }
                    @if (e.photo; as p) {
                      <button type="button" class="ev-ph" [attr.aria-label]="i18n.t('op.openPhoto', { category: i18n.t(photoKey(p.category)), name: p.userName, time: i18n.time(p.createdAt) })" (click)="openPhoto.set(indexOf(p))">
                        @if (p.url) {<img [src]="p.url" alt="" loading="lazy" />}
                      </button>
                    }
                  </div>
                </li>
              </ng-template>
              <div class="main mv">
                <div id="op-tabs" class="tabs" role="tablist" [attr.aria-label]="i18n.t('op.nav')">
                  <button type="button" role="tab" class="tab" [attr.aria-selected]="tab() === 'over'" (click)="tab.set('over')">{{ i18n.t('op.overview') }}</button>
                  <button type="button" role="tab" class="tab" [attr.aria-selected]="tab() === 'photos'" (click)="tab.set('photos')">{{ i18n.t('op.photos') }}<span class="flt-n">{{ d.photos.length }}</span></button>
                  <button type="button" role="tab" class="tab" [attr.aria-selected]="tab() === 'log'" (click)="tab.set('log')">{{ i18n.t('op.history') }}<span class="flt-n">{{ eventCount() }}</span></button>
                </div>
                @switch (tab()) {
                  @case ('over') {
                    @if (o.description) {
                      <section class="card">
                        <h2 class="card-h">{{ i18n.t('op.task') }}</h2>
                        <p class="desc clamp mt-2" [class.is-open]="descOpen()">{{ o.description }}</p>
                        @if (o.description.length > 280) {
                          <button type="button" class="more-link" (click)="descOpen.set(!descOpen())">{{ descOpen() ? i18n.t('op.less') : i18n.t('op.more') }}</button>
                        }
                      </section>
                    }
                    @if (issues().length) {
                      <section id="op-issues" class="block issues" [attr.aria-label]="i18n.t('drill.issues')">
                        <h2 class="h2 is-bad"><aon-icon name="alert" [size]="18" />{{ i18n.t('op.openIssues') }}</h2>
                        <ul>
                          @for (l of issues(); track l.id) {
                            <li>
                              <p class="iss-t">{{ l.text }}</p>
                              <p class="iss-m">{{ workerName(l.userId) }} · {{ i18n.date(l.createdAt) }} {{ i18n.time(l.createdAt) }}</p>
                            </li>
                          }
                        </ul>
                      </section>
                    }
                    @if (d.photos.length) {
                      <section class="card">
                        <div class="card-row"><h2 class="card-h">{{ i18n.t('op.latestPhotos') }}</h2><button type="button" class="card-link" (click)="tab.set('photos')">{{ i18n.t('op.allPhotos', { n: d.photos.length }) }}<aon-icon name="chevron-right" [size]="16" /></button></div>
                        <ul class="peek">
                          @for (p of filteredPhotos().slice(0, 6); track p.id) {
                            <li><button type="button" class="ph" [attr.aria-label]="i18n.t('op.openPhoto', { category: i18n.t(photoKey(p.category)), name: p.userName, time: i18n.time(p.createdAt) })" (click)="openPhoto.set(indexOf(p))">@if (p.url) {<img [src]="p.url" alt="" loading="lazy" />}</button></li>
                          }
                        </ul>
                      </section>
                    }
                    <section class="card">
                      <div class="card-row"><h2 class="card-h">{{ i18n.t('op.latest') }}</h2><button type="button" class="card-link" (click)="tab.set('log')">{{ i18n.t('op.allEvents', { n: eventCount() }) }}<aon-icon name="chevron-right" [size]="16" /></button></div>
                      @if (latestEvents().length) {
                        <ol class="tl">
                          @for (e of latestEvents(); track $index) {
                            <ng-container *ngTemplateOutlet="evTpl; context: { $implicit: e }" />
                          }
                        </ol>
                      } @else {
                        <p class="empty">{{ i18n.t('op.noHistory') }}</p>
                      }
                    </section>
                  }
                  @case ('photos') {
                    <section class="card">
                      @if (d.photos.length) {
                        <div class="flt mb-3" role="group" [attr.aria-label]="i18n.t('op.photos')">
                          <button type="button" class="flt-btn" [attr.aria-pressed]="photoCat() === null" (click)="photoCat.set(null)">{{ i18n.t('mgr.tabAll') }}<span class="flt-n">{{ d.photos.length }}</span></button>
                          @for (g of photoGroups(); track g.category) {
                            @if (g.photos.length) {
                              <button type="button" class="flt-btn" [attr.aria-pressed]="photoCat() === g.category" (click)="photoCat.set(g.category)">{{ i18n.t(photoKey(g.category)) }}<span class="flt-n">{{ g.photos.length }}</span></button>
                            }
                          }
                        </div>
                        <ul class="ph-all">
                          @for (p of filteredPhotos().slice(0, photoLimit()); track p.id) {
                            <li>
                              <button type="button" class="ph" [attr.aria-label]="i18n.t('op.openPhoto', { category: i18n.t(photoKey(p.category)), name: p.userName, time: i18n.time(p.createdAt) })" (click)="openPhoto.set(indexOf(p))">@if (p.url) {<img [src]="p.url" alt="" loading="lazy" />}</button>
                              <p class="ph-cap"><b>{{ p.userName }}</b> · {{ i18n.dateShort(p.createdAt) }} {{ i18n.time(p.createdAt) }}</p>
                              @if (p.caption) {<p class="ph-txt clamp">{{ p.caption }}</p>}
                            </li>
                          }
                        </ul>
                        @if (filteredPhotos().length > photoLimit()) {
                          <button type="button" class="more-btn" (click)="photoLimit.set(photoLimit() + 24)">{{ i18n.t('op.showMore', { n: filteredPhotos().length - photoLimit() }) }}</button>
                        }
                      } @else {
                        <p class="empty">{{ i18n.t('op.noPhotos') }}</p>
                      }
                    </section>
                  }
                  @default {
                    <section class="card">
                      @for (day of recentDays(); track day.date) {
                        <div class="day">
                          <h3 class="day-h">{{ i18n.dateLong(day.date) }}</h3>
                          <ol class="tl">
                            @for (e of day.events; track $index) {
                              <ng-container *ngTemplateOutlet="evTpl; context: { $implicit: e }" />
                            }
                          </ol>
                        </div>
                      } @empty {
                        <p class="empty">{{ i18n.t('op.noHistory') }}</p>
                      }
                      @if (eventCount() > logLimit()) {
                        <button type="button" class="more-btn" (click)="logLimit.set(logLimit() + 20)"><aon-icon name="chevron-down" [size]="17" />{{ i18n.t('op.older', { n: eventCount() - logLimit() }) }}</button>
                      }
                    </section>
                  }
                }
              </div>

              <aside id="op-time" class="side">
                <section class="block">
                  <h2 class="h2">{{ i18n.t('op.timeByWorker') }}</h2>
                  @if (perWorker().length) {
                    <ul class="tw">
                      @for (w of perWorker(); track w.userId) {
                        <li>
                          <span class="who"><span class="ava" [attr.data-tone]="tone(w.name)" aria-hidden="true">{{ initials(w.name) }}</span>{{ w.name }}</span>
                          <span class="num tw-v">{{ hm(w.minutes) }} h</span>
                          <span class="tw-bar" aria-hidden="true"><span [style.width.%]="w.share * 100"></span></span>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="empty">{{ i18n.t('drill.noTime') }}</p>
                  }
                </section>

                <section class="block">
                  <h2 class="h2">{{ i18n.t('drill.material') }}<span class="cnt">{{ o.materials.length }}</span></h2>
                  @if (o.materials.length) {
                    <ul class="mat">
                      @for (m of o.materials; track $index) {
                        <li><span>{{ m.name }}</span><span class="num muted">{{ m.qty !== null ? i18n.number(m.qty) : '' }} {{ m.unit ?? '' }}</span></li>
                      }
                    </ul>
                  } @else {
                    <p class="empty">{{ i18n.t('op.noMaterial') }}</p>
                  }
                </section>

                <section class="block">
                  <h2 class="h2">{{ i18n.t('drill.summaries') }}</h2>
                  @if (summaries().length) {
                    <ul class="reps">
                      @for (s of summaries(); track s.id) {
                        <li>
                          <a class="rep no-print-link" routerLink="/m" [queryParams]="{ report: s.id }">
                            <span class="rep-main">
                              <b>{{ workerName(s.userId) }}</b>
                              <span class="muted num">{{ i18n.date(s.date) }}</span>
                            </span>
                            <aon-report-status [status]="s.status" />
                          </a>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="empty">{{ i18n.t('drill.noSummaries') }}</p>
                  }
                </section>
              </aside>
            </div>

            <!-- Printed only: the order as an A4 document, in the same hand as the daily report and the record. -->
            <article class="sheet">
              <header class="s-head">
                <div>
                  <aon-logo [size]="1.15" />
                  <p class="kicker">{{ org.name() ? org.name() + ' · ' : '' }}{{ projectName() }}</p>
                </div>
                <div class="s-titleblock">
                  <h1 class="s-title">{{ i18n.t('op.docTitle') }}</h1>
                  <p class="s-no num">{{ i18n.t('op.docNo', { code: o.code ?? '–' }) }}</p>
                </div>
              </header>

              <p class="s-job">{{ o.title }}</p>

              <dl class="meta">
                <div><dt>{{ i18n.t('mgr.colSite') }}</dt><dd>{{ o.siteName }}@if (o.location) {<span class="muted"> · {{ o.location }}</span>}</dd></div>
                <div><dt>{{ i18n.t('drill.manager') }}</dt><dd>{{ o.managerName || '–' }}</dd></div>
                <div><dt>{{ i18n.t('mgr.colStatus') }}</dt><dd><span class="st" [attr.data-s]="o.status">{{ i18n.t(statusKey(o.status)) }}</span>@if (!o.published) {<span class="muted"> · {{ i18n.t('mgr.draftShort') }}</span>}</dd></div>
                <div><dt>{{ i18n.t('rec.generated') }}</dt><dd class="num">{{ generated() }}</dd></div>
              </dl>
              <dl class="meta">
                <div><dt>{{ i18n.t('op.date') }}</dt><dd class="num">{{ o.date ? i18n.dateShort(o.date) : '–' }}</dd></div>
                <div><dt>{{ i18n.t('drill.due') }}</dt><dd class="num" [class.bad]="isLate()">{{ o.dueDate ? i18n.dateShort(o.dueDate) : '–' }}@if (isLate()) { · {{ i18n.t('op.late') }}}</dd></div>
                <div><dt>{{ i18n.t('op.estimate') }}</dt><dd class="num">{{ o.estimatedMinutes ? hours(o.estimatedMinutes) : '–' }}</dd></div>
                <div><dt>{{ i18n.t('drill.crew') }}</dt><dd>{{ o.crew.length ? crewAll(o.crew) : i18n.t('mgr.unassigned') }}</dd></div>
              </dl>

              <section class="figs">
                <div class="fig">
                  <p class="fig-k">{{ i18n.t('drill.qty') }}</p>
                  @if (o.plannedQty > 0) {
                    <p class="fig-v num">{{ i18n.number(o.doneQty) }}<span class="fig-u">/ {{ i18n.number(o.plannedQty) }} {{ unitLabel() }}</span></p>
                    <span class="pbar" aria-hidden="true"><span [style.width.%]="qtyRatio() * 100"></span></span>
                    <p class="fig-s">{{ i18n.t('op.percent', { n: pct(qtyRatio()) }) }}</p>
                  } @else {
                    <p class="fig-v">{{ i18n.t('order.noQuantity') }}</p>
                    <p class="fig-s">{{ i18n.t('order.noQuantityDone') }}</p>
                  }
                </div>
                <div class="fig" [class.warn]="hoursOver()">
                  <p class="fig-k">{{ i18n.t('drill.hoursUsed') }}</p>
                  <p class="fig-v num">{{ hm(totalMinutes()) }}<span class="fig-u">@if (o.estimatedMinutes) {/ {{ hm(o.estimatedMinutes) }} }h</span></p>
                  <span class="pbar" aria-hidden="true"><span [style.width.%]="timeRatio() * 100"></span></span>
                  <p class="fig-s">{{ hoursOver() ? i18n.t('op.hoursOver') : i18n.t('op.byWorkers', { n: perWorker().length }) }}</p>
                </div>
                <div class="fig">
                  <p class="fig-k">{{ i18n.t('drill.photos') }}</p>
                  <p class="fig-v num">{{ d.photos.length }}</p>
                </div>
                <div class="fig" [class.bad]="issues().length > 0">
                  <p class="fig-k">{{ i18n.t('drill.issues') }}</p>
                  <p class="fig-v num">{{ issues().length }}</p>
                </div>
              </section>

              @if (o.description) {
                <section class="sec keep">
                  <h2 class="h">{{ i18n.t('op.task') }}</h2>
                  <p class="task">{{ o.description }}</p>
                </section>
              }

              @if (issues().length) {
                <section class="sec">
                  <h2 class="h">{{ i18n.t('op.openIssues') }}</h2>
                  <ol class="issues">
                    @for (l of issues(); track l.id) {
                      <li>
                        <p>{{ l.text }}</p>
                        <p class="muted">{{ workerName(l.userId) }} · {{ i18n.dateShort(l.createdAt) }} {{ i18n.time(l.createdAt) }}</p>
                      </li>
                    }
                  </ol>
                </section>
              }

              <div class="two">
                <section class="sec keep">
                  <h2 class="h">{{ i18n.t('op.timeByWorker') }}</h2>
                  @if (perWorker().length) {
                    <table class="t">
                      <thead>
                        <tr>
                          <th scope="col">{{ i18n.t('mgr.colWorker') }}</th>
                          <th scope="col" class="r">{{ i18n.t('op.colHours') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (w of perWorker(); track w.userId) {
                          <tr>
                            <th scope="row">{{ w.name }}</th>
                            <td class="r num">{{ hm(w.minutes) }}</td>
                          </tr>
                        }
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">{{ i18n.t('rec.total') }}</th>
                          <td class="r num">{{ hm(totalMinutes()) }}</td>
                        </tr>
                      </tfoot>
                    </table>
                  } @else {
                    <p class="none">{{ i18n.t('drill.noTime') }}</p>
                  }
                </section>

                <section class="sec keep">
                  <h2 class="h">{{ i18n.t('drill.material') }}</h2>
                  @if (o.materials.length) {
                    <table class="t">
                      <thead>
                        <tr>
                          <th scope="col">{{ i18n.t('op.colMaterial') }}</th>
                          <th scope="col" class="r">{{ i18n.t('drill.qty') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (m of o.materials; track $index) {
                          <tr>
                            <th scope="row">{{ m.name }}</th>
                            <td class="r num nowrap">{{ m.qty !== null ? i18n.number(m.qty) : '–' }} {{ m.unit ?? '' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else {
                    <p class="none">{{ i18n.t('op.noMaterial') }}</p>
                  }
                </section>
              </div>

              <section class="sec">
                <h2 class="h">{{ i18n.t('op.history') }}</h2>
                @if (printDays().length) {
                  <table class="t log">
                    <thead>
                      <tr>
                        <th scope="col">{{ i18n.t('op.colTime') }}</th>
                        <th scope="col">{{ i18n.t('mgr.colWorker') }}</th>
                        <th scope="col">{{ i18n.t('op.colEvent') }}</th>
                        <th scope="col" class="r">{{ i18n.t('op.colDetail') }}</th>
                      </tr>
                    </thead>
                    @for (day of printDays(); track day.date) {
                      <tbody>
                        <tr class="day-row">
                          <th scope="rowgroup" colspan="4">{{ i18n.dateLong(day.date) }}</th>
                        </tr>
                        @for (e of day.events; track $index) {
                          <tr [class.is-issue]="e.kind === 'issue'">
                            <td class="num nowrap">{{ i18n.time(e.at) }}</td>
                            <td class="nowrap">{{ workerName(e.userId) }}</td>
                            <td>{{ eventLabel(e) }}@if (e.text) {<span class="ev-txt">{{ e.text }}</span>}</td>
                            <td class="r num nowrap">{{ e.figure ?? '' }}</td>
                          </tr>
                        }
                      </tbody>
                    }
                  </table>
                } @else {
                  <p class="none">{{ i18n.t('op.noHistory') }}</p>
                }
              </section>

              @if (summaries().length) {
                <section class="sec keep">
                  <h2 class="h">{{ i18n.t('drill.summaries') }}</h2>
                  <table class="t">
                    <thead>
                      <tr>
                        <th scope="col">{{ i18n.t('rec.colDate') }}</th>
                        <th scope="col">{{ i18n.t('mgr.colWorker') }}</th>
                        <th scope="col">{{ i18n.t('mgr.colStatus') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (s of summaries(); track s.id) {
                        <tr>
                          <td class="num nowrap">{{ i18n.dateShort(s.date) }}</td>
                          <th scope="row">{{ workerName(s.userId) }}</th>
                          <td>{{ i18n.t(summaryKey(s.status)) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </section>
              }

              @if (d.photos.length) {
                <section class="sec">
                  <h2 class="h">{{ i18n.t('op.photos') }}</h2>
                  <ul class="s-photos">
                    @for (p of printPhotos(); track p.id) {
                      <li>
                        @if (p.url) {<img [src]="p.url" alt="" />}
                        <p><span class="strong">{{ i18n.t(photoKey(p.category)) }}</span> · {{ p.userName }} · <span class="num">{{ i18n.dateShort(p.createdAt) }} {{ i18n.time(p.createdAt) }}</span></p>
                      </li>
                    }
                  </ul>
                  @if (d.photos.length > printPhotos().length) {
                    <p class="none">{{ i18n.t('op.photosMore', { n: d.photos.length - printPhotos().length }) }}</p>
                  }
                </section>
              }

              <p class="legend keep">{{ i18n.t('op.legend') }}</p>

              <section class="sign keep">
                <div><span class="line"></span><p>{{ i18n.t('op.signManager') }}</p></div>
                <div><span class="line"></span><p>{{ i18n.t('op.signCrew') }}</p></div>
                <div><span class="line"></span><p>{{ i18n.t('rec.signDate') }}</p></div>
              </section>

              <footer class="s-foot">
                <span>{{ i18n.t('op.docTitle') }} · {{ o.title }}</span>
                <span class="num">{{ o.code ?? '' }}</span>
              </footer>
            </article>
          }
        }
      }
    </div>

    @if (openPhoto() !== null && data(); as d) {
      @let p = d.photos[openPhoto()!];
      @if (p) {
        <div class="lb" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t(photoKey(p.category))" (click)="openPhoto.set(null)">
          <div class="lb-top" (click)="$event.stopPropagation()">
            <p>
              <b>{{ i18n.t(photoKey(p.category)) }}</b>
              <span>{{ p.userName }} · {{ i18n.date(p.createdAt) }} {{ i18n.time(p.createdAt) }} · {{ i18n.t('order.numberLabel', { code: d.order.code ?? '–' }) }}</span>
            </p>
            <button type="button" class="lb-x" [attr.aria-label]="i18n.t('common.close')" (click)="openPhoto.set(null)"><aon-icon name="x" [size]="22" /></button>
          </div>
          <div class="lb-img" (click)="$event.stopPropagation()">
            @if (p.url) {
              <img [src]="p.url" [alt]="p.caption || i18n.t(photoKey(p.category))" />
            }
            @if (d.photos.length > 1) {
              <button type="button" class="lb-nav is-prev" [attr.aria-label]="i18n.t('op.prevPhoto')" (click)="stepPhoto(-1)"><aon-icon name="chevron-left" [size]="26" /></button>
              <button type="button" class="lb-nav is-next" [attr.aria-label]="i18n.t('op.nextPhoto')" (click)="stepPhoto(1)"><aon-icon name="chevron-right" [size]="26" /></button>
            }
          </div>
          @if (p.caption) {
            <p class="lb-cap" (click)="$event.stopPropagation()">{{ p.caption }}</p>
          }
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .op {
      max-width: 84rem;
      margin: 0 auto;
      padding: 1rem 2rem 3rem;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .muted {
      color: var(--color-text-muted);
    }
    .bad {
      color: var(--color-bad);
      font-weight: 650;
    }

    /* Bar: back to the list on the left, the order's actions on the right. */
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem 1rem;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.75rem;
      color: var(--color-text-muted);
      font-weight: 550;
      text-decoration: none;
    }
    .back:hover {
      color: var(--color-text);
    }
    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }
    .tool {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.6rem;
      padding: 0 0.9rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.55rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 600;
      text-decoration: none;
      transition: border-color 150ms var(--ease-out-expo);
    }
    .tool:hover {
      border-color: var(--color-text-muted);
    }
    .tool.is-main {
      border-color: var(--color-gold);
      background: var(--color-gold);
      color: var(--color-charcoal);
    }
    .tool.is-danger {
      color: var(--color-bad-ink);
    }
    .tool.is-danger:hover {
      border-color: var(--color-bad);
      background: var(--color-bad-tint);
    }

    /* Head: the document's identity. The site drawing sits behind it on the right, melted into the paper. */
    .head {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      margin-top: 0.75rem;
      padding: 1.6rem 1.75rem 1.4rem;
      border-radius: 1rem;
      background: #f7f6f2;
      box-shadow: inset 0 0 0 1px var(--color-line), 0 14px 32px -26px rgb(20 20 20 / 0.45);
    }
    .head-art {
      position: absolute;
      inset: 0 0 auto auto;
      z-index: -1;
      width: min(48%, 34rem);
      height: 13rem;
      object-fit: contain;
      object-position: right top;
      opacity: 0.85;
      mix-blend-mode: multiply;
      -webkit-mask-image: radial-gradient(85% 120% at 100% 0%, #000 40%, transparent 100%);
      mask-image: radial-gradient(85% 120% at 100% 0%, #000 40%, transparent 100%);
    }
    .head-in {
      max-width: 44rem;
    }
    .h1 {
      display: grid;
      gap: 0.3rem;
    }
    .h1-no {
      color: var(--color-gold-ink);
      font-size: 1rem;
      font-weight: 650;
      letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
    }
    .h1-title {
      color: var(--color-text);
      font-size: clamp(1.7rem, 1.2rem + 1.6vw, 2.5rem);
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.1;
      text-wrap: balance;
    }
    .where {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.6rem;
      color: var(--color-text-muted);
      font-size: 1rem;
    }
    .dot {
      margin: 0 0.15rem;
    }
    .head-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.9rem;
    }
    .status,
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      min-height: 1.9rem;
      padding: 0 0.7rem;
      border-radius: 9999px;
      background: var(--color-new-tint);
      color: var(--color-new-ink);
      font-size: 0.9rem;
      font-weight: 600;
    }
    .status[data-s='IN_PROGRESS'] {
      background: var(--color-blue-tint);
      color: var(--color-blue);
    }
    .status[data-s='COMPLETED'] {
      background: var(--color-ok-tint);
      color: var(--color-ok-ink);
    }
    .status[data-s='ISSUE'],
    .tag.is-bad {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .path {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      max-width: 32rem;
      margin-top: 1.4rem;
    }
    .path li {
      position: relative;
      display: grid;
      justify-items: start;
      gap: 0.35rem;
    }
    .path li + li::before {
      content: '';
      position: absolute;
      top: 0.6rem;
      right: calc(100% - 0.2rem);
      left: -100%;
      margin-left: 1.55rem;
      height: 2px;
      border-radius: 2px;
      background: var(--color-line-strong);
    }
    .path li.is-done + li::before,
    .path li.is-done + li.is-now::before {
      background: var(--color-gold);
    }
    .path-dot {
      display: grid;
      place-items: center;
      width: 1.3rem;
      height: 1.3rem;
      border-radius: 9999px;
      background: var(--color-panel);
      box-shadow: inset 0 0 0 2px var(--color-line-strong);
      color: var(--color-charcoal);
    }
    .path li.is-done .path-dot {
      background: var(--color-gold);
      box-shadow: none;
    }
    .path li.is-now .path-dot {
      box-shadow: inset 0 0 0 2px var(--color-charcoal), 0 0 0 4px rgb(193 160 80 / 0.25);
    }
    .path li.is-bad .path-dot {
      background: var(--color-bad);
      color: #fff;
      box-shadow: 0 0 0 4px rgb(200 21 29 / 0.15);
    }
    .path-l {
      color: var(--color-text-muted);
      font-size: 0.88rem;
      font-weight: 550;
    }
    .path li.is-now .path-l {
      color: var(--color-text);
      font-weight: 650;
    }
    .path li.is-bad .path-l {
      color: var(--color-bad);
    }

    /* Facts: a ruled form, six fields in one band. */
    .facts {
      display: grid;
      grid-template-columns: 1.3fr 1fr 1.6fr 0.9fr 0.9fr 0.9fr;
      margin-top: 1rem;
      border-top: 1px solid var(--color-line-strong);
      border-bottom: 1px solid var(--color-line-strong);
    }
    .facts > div {
      min-width: 0;
      padding: 0.8rem 1rem 0.85rem 0;
    }
    .facts > div + div {
      padding-left: 1rem;
      border-left: 1px solid var(--color-line);
    }
    .facts dt {
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .facts dd {
      margin-top: 0.2rem;
      font-size: 1.05rem;
      font-weight: 600;
    }
    /* Crew: a few faces and names for any crew size; the whole list on demand. */
    .crew {
      position: relative;
    }
    .crew .stack {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem 0.6rem;
    }
    .crew .avs {
      display: flex;
      padding-left: 0.35rem;
    }
    .crew .avs .ava {
      width: 2rem;
      height: 2rem;
      margin-left: -0.35rem;
      box-shadow: 0 0 0 2px var(--color-site);
      font-size: 0.74rem;
    }
    .crew .avs .ava.is-more {
      background: var(--color-charcoal);
    }
    .crew .names {
      flex: 1 1 9rem;
      min-width: 0;
      font-weight: 600;
      line-height: 1.3;
    }
    .crew .names small {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.82rem;
      font-weight: 500;
    }
    .crew .toggle {
      margin-top: 0.4rem;
      color: var(--color-text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    /* On a wide screen the full crew opens over the page instead of stretching the facts band. */
    .crew .all {
      position: absolute;
      top: calc(100% - 0.4rem);
      left: 0.6rem;
      z-index: 10;
      display: grid;
      grid-template-columns: repeat(2, minmax(9rem, 1fr));
      gap: 0.4rem 1rem;
      width: max-content;
      max-width: min(30rem, 80vw);
      max-height: 18rem;
      overflow-y: auto;
      padding: 0.8rem 0.9rem;
      border-radius: 0.7rem;
      background: var(--color-panel);
      box-shadow: 0 0 0 1px var(--color-line-strong), 0 18px 36px -18px rgb(20 20 20 / 0.45);
      font-size: 0.92rem;
      font-weight: 500;
    }
    @media (max-width: 700px) {
      .crew .all {
        position: static;
        width: auto;
        max-width: none;
        margin-top: 0.5rem;
        box-shadow: inset 0 0 0 1px var(--color-line);
      }
    }
    .who {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }
    .ava {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: 1.7rem;
      height: 1.7rem;
      border-radius: 9999px;
      background: var(--color-avatar-sage, #4f7a72);
      color: #fff;
      font-size: 0.72rem;
      font-weight: 650;
    }
    .ava[data-tone='1'] {
      background: #5d6f93;
    }
    .ava[data-tone='2'] {
      background: #b9984a;
    }
    .ava[data-tone='3'] {
      background: #a85a55;
    }
    .ava[data-tone='4'] {
      background: #7b6a94;
    }

    /* Progress band: two meters against plan, two counts. */
    .progress {
      display: grid;
      grid-template-columns: 1.6fr 1.6fr 0.7fr 0.7fr;
      gap: 0.75rem;
      margin-top: 1rem;
    }
    .meter {
      display: grid;
      align-content: start;
      text-align: left;
      cursor: pointer;
      transition: box-shadow 160ms var(--ease-out-expo), transform 160ms var(--ease-out-expo);
      gap: 0.45rem;
      padding: 0.95rem 1.1rem 1rem;
      border-radius: 0.85rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 8px 22px -18px rgb(20 20 20 / 0.35);
    }
    /* Each figure leads to where it comes from. */
    .meter:hover {
      box-shadow: inset 0 0 0 1.5px var(--color-line-strong), 0 10px 24px -18px rgb(20 20 20 / 0.45);
    }
    .meter:active {
      transform: scale(0.99);
    }
    .meter:focus-visible {
      outline: 2px solid var(--color-charcoal);
      outline-offset: 2px;
    }
    .m-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .m-k {
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    .m-v {
      font-size: 1.7rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .m-of {
      color: var(--color-text-muted);
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: 0;
    }
    .bar-t {
      display: block;
      height: 8px;
      overflow: hidden;
      border-radius: 4px;
      background: var(--color-track);
    }
    .bar-t > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-progress);
      transition: width 500ms var(--ease-out-expo);
    }
    .meter.is-over .bar-t > span {
      background: var(--color-bad);
    }
    .meter.is-over .m-v {
      color: var(--color-bad);
    }
    .m-s {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .meter.is-small .m-v {
      font-size: 2rem;
    }
    .meter.is-bad .m-v,
    .meter.is-bad .m-k {
      color: var(--color-bad);
    }
    .live {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      background: var(--color-ok);
      box-shadow: 0 0 0 3px rgb(31 122 60 / 0.18);
    }

    /* Body: the work on the left, the people and the paperwork on the right. */
    .cols {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
      gap: 1.5rem;
      align-items: start;
      margin-top: 1.5rem;
    }
    .main,
    .side {
      display: grid;
      gap: 1.75rem;
    }
    .side {
      position: sticky;
      top: 1rem;
      padding: 1.2rem 1.25rem;
      border-radius: 0.95rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 8px 22px -18px rgb(20 20 20 / 0.35);
    }
    .h2 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.7rem;
      font-size: 1.15rem;
      font-weight: 650;
    }
    .h2.is-bad {
      color: var(--color-bad);
    }
    .cnt {
      min-width: 1.6rem;
      padding: 0 0.45rem;
      border-radius: 9999px;
      background: var(--color-track);
      color: var(--color-text-muted);
      font-size: 0.82rem;
      font-weight: 600;
      line-height: 1.6rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .desc {
      max-width: 70ch;
      font-size: 1.05rem;
      line-height: 1.55;
      white-space: pre-line;
    }
    .empty {
      color: var(--color-text-muted);
    }
    .issues ul {
      display: grid;
      gap: 0.5rem;
    }
    .issues li {
      padding: 0.75rem 0.9rem;
      border-radius: 0.65rem;
      background: var(--color-bad-tint);
      box-shadow: inset 0 0 0 1px var(--color-alert-line, #ef9a9a);
    }
    .iss-t {
      color: var(--color-bad-ink);
      font-weight: 600;
    }
    .iss-m {
      margin-top: 0.15rem;
      color: var(--color-bad-ink);
      font-size: 0.85rem;
      opacity: 0.85;
    }

    /* Photos by what they document. */
    .ph {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border-radius: 0.65rem;
      background: var(--color-track);
      cursor: zoom-in;
    }
    .ph img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 300ms var(--ease-out-expo);
    }
    .ph:hover img {
      transform: scale(1.03);
    }
    .ph-miss {
      display: grid;
      place-items: center;
      align-content: center;
      gap: 0.35rem;
      height: 100%;
      padding: 0.5rem;
      color: var(--color-text-muted);
      font-size: 0.8rem;
      text-align: center;
    }
    .ph-cap {
      margin-top: 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.82rem;
    }
    .ph-cap b {
      color: var(--color-text);
      font-weight: 600;
    }
    .ph-txt {
      font-size: 0.88rem;
      line-height: 1.35;
    }

    /* History: a day per block, a line per event, the time in the gutter. */
    .day + .day {
      margin-top: 1.25rem;
    }
    .day-h {
      margin-bottom: 0.5rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      font-weight: 600;
    }
    .day-h::first-letter {
      text-transform: uppercase;
    }
    .tl {
      position: relative;
      display: grid;
    }
    .ev {
      position: relative;
      display: grid;
      grid-template-columns: 3.4rem 1.6rem minmax(0, 1fr);
      gap: 0.6rem;
      padding-bottom: 0.75rem;
    }
    .ev:not(:last-child)::after {
      content: '';
      position: absolute;
      top: 1.7rem;
      bottom: 0.15rem;
      left: calc(3.4rem + 0.6rem + 0.8rem - 1px);
      width: 2px;
      background: var(--color-line);
    }
    .ev-time {
      padding-top: 0.2rem;
      color: var(--color-text-muted);
      font-size: 0.88rem;
      text-align: right;
    }
    .ev-ico {
      display: grid;
      place-items: center;
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text);
    }
    .ev[data-k='start'] .ev-ico,
    .ev[data-k='qty'] .ev-ico {
      background: var(--color-gold-fill);
      color: var(--color-gold-ink);
    }
    .ev[data-k='issue'] .ev-ico {
      background: var(--color-bad-tint);
      color: var(--color-bad);
    }
    .ev[data-k='fix'] .ev-ico {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .ev-line {
      padding-top: 0.15rem;
      line-height: 1.4;
    }
    .ev-line b {
      font-weight: 650;
    }
    .ev-fig {
      margin-left: 0.25rem;
      font-weight: 650;
    }
    .ev[data-k='fix'] .ev-fig {
      color: var(--color-bad-ink);
    }
    .ev-text {
      margin-top: 0.15rem;
      color: #3d3c39;
      font-size: 0.95rem;
      line-height: 1.45;
    }
    .ev[data-k='issue'] .ev-text {
      color: var(--color-bad-ink);
    }

    /* Main column: an overview, all photos, or the full log; long text and many photos open on demand. */
    .clamp {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 4;
    }
    .clamp.is-open {
      display: block;
    }
    .more-link {
      margin-top: 0.15rem;
      color: var(--color-text-muted);
      font-size: 0.88rem;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .ev-ph {
      display: block;
      width: 7.5rem;
      margin-top: 0.4rem;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border-radius: 0.5rem;
      background: var(--color-track);
      cursor: zoom-in;
    }
    .ev-ph img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .card {
      padding: 1.1rem 1.25rem 1.2rem;
      border-radius: 0.95rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 8px 22px -18px rgb(20 20 20 / 0.35);
    }
    .card-h {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.12rem;
      font-weight: 650;
    }
    .card-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem 1rem;
      margin-bottom: 0.85rem;
    }
    .card-link {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      min-height: 2.5rem;
      color: var(--color-text);
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .more-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      width: 100%;
      min-height: 2.9rem;
      margin-top: 0.75rem;
      border-radius: 0.65rem;
      background: var(--color-field);
      font-weight: 650;
    }
    .mv {
      display: grid;
      gap: 1rem;
    }
    .tabs {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      gap: 0.25rem;
      padding: 0.35rem;
      border-radius: 0.8rem;
      background: color-mix(in srgb, var(--color-site) 90%, transparent);
      backdrop-filter: blur(8px);
      box-shadow: inset 0 0 0 1px var(--color-line);
    }
    .tab {
      display: inline-flex;
      flex: 1 1 0;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-height: 2.75rem;
      border-radius: 0.55rem;
      color: var(--color-text-muted);
      font-weight: 600;
    }
    .tab[aria-selected='true'] {
      background: var(--color-panel);
      color: var(--color-text);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.1);
    }
    .tab .flt-n {
      color: inherit;
    }
    .peek {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      gap: 0.6rem;
    }
    .ph-all {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: 0.85rem;
    }
    /* Side lists */
    .tw {
      display: grid;
      gap: 0.75rem;
    }
    .tw li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.35rem 0.75rem;
      align-items: center;
    }
    .tw-v {
      font-weight: 650;
    }
    .tw-bar {
      grid-column: 1 / -1;
      height: 5px;
      overflow: hidden;
      border-radius: 3px;
      background: var(--color-track);
    }
    .tw-bar > span {
      display: block;
      height: 100%;
      background: var(--color-progress);
    }
    .mat li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--color-line);
    }
    .mat li:last-child {
      border-bottom: 0;
    }
    .reps {
      display: grid;
      gap: 0.4rem;
    }
    .rep {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.6rem 0.7rem;
      border-radius: 0.6rem;
      background: var(--color-row-tint);
      box-shadow: inset 0 0 0 1px var(--color-line);
      color: var(--color-text);
      text-decoration: none;
    }
    .rep:hover {
      box-shadow: inset 0 0 0 1px var(--color-line-strong);
    }
    .rep-main {
      display: grid;
    }
    .rep-main .muted {
      font-size: 0.85rem;
    }

    .skel {
      height: 70vh;
      margin-top: 1rem;
      border-radius: 1rem;
      background: var(--color-track);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .err {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding: 0.8rem 1rem;
      border-radius: 0.65rem;
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .err button {
      margin-left: auto;
      font-weight: 650;
      text-decoration: underline;
    }

    /* Lightbox */
    .lb {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: rgb(20 20 20 / 0.94);
      color: #fff;
      animation: lb-in 200ms var(--ease-out-expo) both;
    }
    @keyframes lb-in {
      from {
        opacity: 0;
      }
    }
    .lb-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
    }
    .lb-top p {
      display: grid;
    }
    .lb-top span {
      color: var(--color-rail-muted);
      font-size: 0.9rem;
    }
    .lb-x {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border-radius: 0.6rem;
      background: rgb(255 255 255 / 0.1);
    }
    .lb-img {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 0;
      padding: 0 4.5rem;
    }
    .lb-img img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 0.4rem;
    }
    .lb-nav {
      position: absolute;
      top: 50%;
      display: grid;
      place-items: center;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: 9999px;
      background: rgb(255 255 255 / 0.12);
      transform: translateY(-50%);
    }
    .lb-nav.is-prev {
      left: 1rem;
    }
    .lb-nav.is-next {
      right: 1rem;
    }
    .lb-cap {
      max-width: 60rem;
      margin: 0 auto;
      padding: 0.9rem 1.25rem 1.25rem;
      text-align: center;
    }
    /* The printed order: ink on paper, hairlines, one heavy rule under the head; colour only where it means
       something. Hidden on screen, it replaces the whole page in print. */
    .sheet {
      display: none;
      --rule: #1b1b1b;
      --hair: #dcd9d1;
      --soft: #f5f3ee;
      --muted: #6a6862;
      --gold: #a8873a;
      --bad: #b3121b;
      color: #161616;
      font-size: 9.5pt;
      line-height: 1.4;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .sheet .num {
      font-variant-numeric: tabular-nums;
    }
    .sheet .strong {
      font-weight: 600;
    }
    .sheet .muted {
      color: var(--muted);
    }
    .sheet .nowrap {
      white-space: nowrap;
    }
    .sheet .bad {
      color: var(--bad);
      font-weight: 600;
    }
    .s-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 2rem;
      padding-bottom: 0.7rem;
      border-bottom: 2.5px solid var(--rule);
    }
    .kicker {
      margin-top: 0.35rem;
      color: var(--muted);
      font-size: 7.5pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .s-titleblock {
      text-align: right;
    }
    .s-title {
      font-size: 17pt;
      font-weight: 650;
      letter-spacing: -0.015em;
      line-height: 1.1;
    }
    .s-no {
      margin-top: 0.15rem;
      color: var(--gold);
      font-size: 11pt;
      font-weight: 600;
    }
    .s-job {
      padding: 0.6rem 0 0.55rem;
      border-bottom: 1px solid var(--hair);
      font-size: 13pt;
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .meta {
      display: grid;
      grid-template-columns: 1.5fr 1fr 1fr 1fr;
      border-bottom: 1px solid var(--hair);
    }
    .meta > div {
      padding: 0.5rem 0.7rem 0.5rem 0;
    }
    .meta > div + div {
      padding-left: 0.7rem;
      border-left: 1px solid var(--hair);
    }
    .meta dt,
    .fig-k,
    .t thead th {
      color: var(--muted);
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .meta dd {
      margin-top: 0.1rem;
    }
    .st {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      white-space: nowrap;
    }
    .st::before {
      content: '';
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 9999px;
      background: #8e96a6;
    }
    .st[data-s='IN_PROGRESS']::before {
      background: #1f4fa3;
    }
    .st[data-s='COMPLETED']::before {
      background: var(--gold);
    }
    .st[data-s='ISSUE'] {
      color: var(--bad);
      font-weight: 650;
    }
    .st[data-s='ISSUE']::before {
      background: var(--bad);
    }
    .figs {
      display: grid;
      grid-template-columns: 1.4fr 1.4fr 0.8fr 0.8fr;
      margin-top: 0.9rem;
      border: 1px solid var(--hair);
      border-radius: 4px;
    }
    .fig {
      padding: 0.6rem 0.75rem 0.65rem;
    }
    .fig + .fig {
      border-left: 1px solid var(--hair);
    }
    .fig-v {
      margin-top: 0.15rem;
      font-size: 16pt;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .fig-u {
      margin-left: 0.25rem;
      color: var(--muted);
      font-size: 9pt;
      font-weight: 500;
    }
    .fig-s {
      margin-top: 0.2rem;
      color: var(--muted);
      font-size: 7.5pt;
    }
    .fig.warn .fig-v {
      color: #7a5d17;
    }
    .fig.bad .fig-v {
      color: var(--bad);
    }
    .pbar {
      display: block;
      height: 3px;
      margin-top: 0.4rem;
      border-radius: 2px;
      background: var(--soft);
      overflow: hidden;
    }
    .pbar > span {
      display: block;
      height: 100%;
      background: var(--gold);
    }
    .sec {
      margin-top: 1.15rem;
    }
    .h {
      margin-bottom: 0.3rem;
      font-size: 10.5pt;
      font-weight: 650;
    }
    .task {
      white-space: pre-line;
    }
    .none {
      color: var(--muted);
    }
    .sheet .issues {
      display: grid;
      gap: 0.35rem;
      font-size: 8.8pt;
    }
    .sheet .issues li {
      padding: 0.35rem 0.6rem;
      border-left: 3px solid var(--bad);
      border-radius: 0;
      background: #fbe5e6;
      box-shadow: none;
      break-inside: avoid;
    }
    /* The app's wide-table scroll (styles.css) is for screens; on paper a table fits its column. */
    .sheet section {
      overflow: visible;
    }
    .sheet .t {
      min-width: 0;
    }
    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    .t {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.6pt;
    }
    .t th,
    .t td {
      padding: 0.28rem 0.45rem;
      text-align: left;
      vertical-align: baseline;
    }
    .t .r {
      text-align: right;
    }
    .t thead th {
      padding-top: 0.35rem;
      padding-bottom: 0.35rem;
      border-bottom: 1.5px solid var(--rule);
      white-space: nowrap;
    }
    .t th:first-child,
    .t td:first-child {
      padding-left: 0;
    }
    .t th:last-child,
    .t td:last-child {
      padding-right: 0;
    }
    .t tbody th {
      font-weight: 400;
    }
    .t tbody tr {
      border-bottom: 1px solid #eeece6;
      break-inside: avoid;
    }
    .t tfoot tr {
      border-top: 2px solid var(--rule);
      font-weight: 700;
    }
    .t tfoot th {
      font-weight: 700;
    }
    .log .day-row th {
      padding-top: 0.55rem;
      font-weight: 650;
    }
    .log .day-row th::first-letter {
      text-transform: uppercase;
    }
    .log tbody {
      break-inside: auto;
    }
    .log tr.is-issue td {
      color: var(--bad);
    }
    .ev-txt {
      display: block;
      color: var(--muted);
    }
    .is-issue .ev-txt {
      color: var(--bad);
    }
    .s-photos {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.6rem;
    }
    .s-photos li {
      break-inside: avoid;
    }
    .s-photos img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: 2px;
      background: var(--soft);
    }
    .s-photos p {
      margin-top: 0.2rem;
      color: var(--muted);
      font-size: 7pt;
    }
    .legend {
      margin-top: 1.1rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7.6pt;
    }
    .sign {
      display: grid;
      grid-template-columns: 1.4fr 1.4fr 1fr;
      gap: 2rem;
      margin-top: 2.2rem;
    }
    .sign .line {
      display: block;
      height: 2.2rem;
      border-bottom: 1px solid var(--rule);
    }
    .sign p {
      margin-top: 0.25rem;
      color: var(--muted);
      font-size: 7.5pt;
    }
    .s-foot {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin-top: 1.4rem;
      padding-top: 0.35rem;
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7pt;
    }
    .keep {
      break-inside: avoid;
    }

    @media (max-width: 1100px) {
      .facts {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .facts > div:nth-child(4) {
        padding-left: 0;
        border-left: 0;
      }
      .facts > div:nth-child(n + 4) {
        border-top: 1px solid var(--color-line);
      }
      .progress {
        grid-template-columns: 1fr 1fr;
      }
      .cols {
        grid-template-columns: minmax(0, 1fr);
      }
      .side {
        position: static;
      }
    }
    @media (max-width: 700px) {
      .op {
        padding: 0.75rem 0.9rem 2rem;
      }
      .head {
        padding: 1.2rem 1.1rem 1.1rem;
      }
      .head-art {
        width: 70%;
        height: 9rem;
        opacity: 0.45;
      }
      .facts {
        grid-template-columns: 1fr 1fr;
      }
      .facts > div,
      .facts > div + div {
        padding: 0.7rem 0.75rem 0.7rem 0;
        border-left: 0;
        border-top: 1px solid var(--color-line);
      }
      .facts > div:nth-child(-n + 2) {
        border-top: 0;
      }
      .crew {
        grid-column: 1 / -1;
      }
      .progress {
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      }
      .progress .meter:not(.is-small) {
        grid-column: 1 / -1;
      }
      .tools {
        width: 100%;
      }
      .tool {
        flex: 1 1 auto;
        justify-content: center;
      }
      .lb-img {
        padding: 0 0.5rem;
      }
      .lb-nav {
        top: auto;
        bottom: -3.75rem;
        transform: none;
      }
    }

    /* Printed: only the A4 work order. */
    @media print {
      .op {
        max-width: none;
        padding: 0;
      }
      .op > :not(.sheet) {
        display: none !important;
      }
      .sheet {
        display: block;
      }
    }
  `,
})
export class OrderPageComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly org = inject(OrgService);
  private readonly orgLoad = this.org.load();
  private readonly store = inject(ManagerStore);
  private readonly clock = inject(ClockService);
  private readonly document = inject(DOCUMENT);
  private readonly network = inject(NetworkStatusService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Only the administrator deletes orders, and only those nobody has worked on yet. */
  protected readonly isAdmin = this.store.isAdmin;
  protected readonly deleting = signal(false);
  protected readonly deleteBusy = signal(false);
  protected readonly deleteError = signal<string | null>(null);

  /** Route param `:id`, bound by withComponentInputBinding. */
  readonly id = input.required<string>();

  protected readonly hm = hm;
  protected readonly photoIcon = PHOTO_ICON;
  protected readonly steps: readonly WorkOrderStatus[] = ['NEW', 'IN_PROGRESS', 'COMPLETED'];
  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly openPhoto = signal<number | null>(null);
  private seq = 0;

  protected readonly data = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });

  private readonly names = computed(() => {
    const map = new Map<string, string>();
    for (const w of this.store.overview()?.workers ?? []) map.set(w.user.id, w.user.displayName);
    for (const w of this.store.directory()?.workers ?? []) map.set(w.user.id, w.user.displayName);
    for (const c of this.data()?.order.crew ?? []) map.set(c.id, c.displayName);
    for (const p of this.data()?.photos ?? []) map.set(p.userId, p.userName);
    return map;
  });

  protected readonly projectName = computed(() => {
    const o = this.data()?.order;
    if (!o) return '';
    const p = this.store.overview()?.projects.find((x) => x.id === o.projectId) ?? this.store.directory()?.projects.find((x) => x.id === o.projectId);
    return p ? `${p.name} (${p.code})` : o.siteName.split('·')[0]?.trim() || '–';
  });
  protected readonly unitLabel = computed(() => this.i18n.t(`unit.${this.data()?.order.unit ?? 'PCS'}` as TranslationKey));
  protected readonly step = computed(() => {
    const s = this.data()?.order.status;
    return s === 'COMPLETED' ? 3 : s === 'IN_PROGRESS' || s === 'ISSUE' ? 1 : 0;
  });
  protected readonly isLate = computed(() => {
    const o = this.data()?.order;
    return !!o?.dueDate && o.status !== 'COMPLETED' && o.dueDate < toIsoDate();
  });

  private readonly segments = computed(() => (this.data()?.timeEntries ?? []).filter((e) => e.kind === 'ORDER'));
  protected readonly totalMinutes = computed(() => {
    const now = this.clock.now();
    return this.segments().reduce((s, e) => s + minutesBetween(e.startedAt, e.endedAt ?? now), 0);
  });
  protected readonly qtyRatio = computed(() => {
    const o = this.data()?.order;
    return o && o.plannedQty > 0 ? Math.min(1, o.doneQty / o.plannedQty) : 0;
  });
  protected readonly timeRatio = computed(() => {
    const est = this.data()?.order.estimatedMinutes ?? 0;
    return est > 0 ? Math.min(1, this.totalMinutes() / est) : this.totalMinutes() > 0 ? 1 : 0;
  });
  protected readonly hoursOver = computed(() => {
    const est = this.data()?.order.estimatedMinutes ?? 0;
    return est > 0 && this.totalMinutes() > est;
  });
  protected readonly running = computed(() => [...new Set(this.segments().filter((e) => e.endedAt === null).map((e) => this.workerName(e.userId)))]);
  protected readonly perWorker = computed(() => {
    const now = this.clock.now();
    const by = new Map<string, number>();
    for (const e of this.segments()) by.set(e.userId, (by.get(e.userId) ?? 0) + minutesBetween(e.startedAt, e.endedAt ?? now));
    const max = Math.max(1, ...by.values());
    return [...by.entries()]
      .map(([userId, minutes]) => ({ userId, name: this.workerName(userId), minutes, share: minutes / max }))
      .sort((a, b) => b.minutes - a.minutes);
  });
  protected readonly issues = computed(() => (this.data()?.logs ?? []).filter((l) => l.kind === 'ISSUE').sort((a, b) => b.createdAt - a.createdAt));
  protected readonly summaries = computed(() => [...(this.data()?.summaries ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)));
  protected readonly photoGroups = computed(() =>
    PHOTO_CATEGORIES.map((category) => ({
      category,
      photos: (this.data()?.photos ?? []).filter((p) => p.category === category).sort((a, b) => b.createdAt - a.createdAt),
    })),
  );

  /** Everything that happened on the order, newest day first, in time order within a day. */
  protected readonly days = computed<Day[]>(() => {
    const d = this.data();
    if (!d) return [];
    const unit = this.unitLabel();
    const events: OrderEvent[] = [];
    for (const e of this.segments() as TimeEntry[]) {
      events.push({ at: e.startedAt, kind: 'start', userId: e.userId, text: null, figure: null, photo: null });
      if (e.endedAt !== null) {
        events.push({ at: e.endedAt, kind: 'stop', userId: e.userId, text: null, figure: `${hm(minutesBetween(e.startedAt, e.endedAt))} h`, photo: null });
      }
    }
    for (const l of d.logs as LogEntry[]) {
      if (l.kind === 'QUANTITY') {
        const q = l.quantity ?? 0;
        events.push({ at: l.createdAt, kind: q < 0 ? 'fix' : 'qty', userId: l.userId, text: l.text, figure: `${q < 0 ? '−' : '+'}${this.i18n.number(Math.abs(q))} ${unit}`, photo: null });
      } else {
        events.push({ at: l.createdAt, kind: l.kind === 'ISSUE' ? 'issue' : 'note', userId: l.userId, text: l.text, figure: null, photo: null });
      }
    }
    for (const p of d.photos) {
      events.push({ at: p.createdAt, kind: 'photo', userId: p.userId, text: p.caption, figure: this.i18n.t(this.photoKey(p.category)), photo: p });
    }
    const byDay = new Map<string, OrderEvent[]>();
    for (const e of events.sort((a, b) => a.at - b.at)) {
      const key = toIsoDate(e.at);
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, list]) => ({ date, events: list }));
  });

  // ---- crew
  protected readonly crewOpen = signal(false);
  /** "Janez, Marko in 8 drugih" style lead line for a crew of any size. */
  protected crewLead(crew: ReadonlyArray<{ readonly displayName: string }>): string {
    const names = crew.map((c) => c.displayName);
    if (names.length <= 2) return names.join(', ');
    return this.i18n.t('op.crewLead', { a: names[0] ?? '', b: names[1] ?? '', n: names.length - 2 });
  }

  // ---- main column
  protected readonly tab = signal<'over' | 'photos' | 'log'>('over');
  protected readonly photoCat = signal<PhotoCategory | null>(null);
  protected readonly descOpen = signal(false);
  protected readonly openTexts = signal<ReadonlySet<string>>(new Set());
  protected readonly photoLimit = signal(24);
  protected readonly logLimit = signal(20);
  protected toggleText(key: string): void {
    const next = new Set(this.openTexts());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.openTexts.set(next);
  }
  protected readonly filteredPhotos = computed(() => {
    const c = this.photoCat();
    return [...(this.data()?.photos ?? [])].filter((p) => !c || p.category === c).sort((a, b) => b.createdAt - a.createdAt);
  });
  protected readonly eventCount = computed(() => this.days().reduce((n, d) => n + d.events.length, 0));
  /** The newest events up to the limit, still grouped by day and in time order within a day. */
  protected readonly recentDays = computed(() => {
    let left = this.logLimit();
    const out: Day[] = [];
    for (const d of this.days()) {
      if (left <= 0) break;
      const take = d.events.slice(-left);
      left -= take.length;
      out.push({ date: d.date, events: take });
    }
    return out;
  });
  protected readonly latestEvents = computed(() => this.days().flatMap((d) => [...d.events].reverse()).slice(0, 5));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    if (!this.store.directory()) void this.store.loadDirectory();
  }

  protected async load(id = this.id()): Promise<void> {
    const seq = ++this.seq;
    this.state.set({ kind: 'LOADING' });
    try {
      const data = await this.store.detail(id);
      if (seq === this.seq) {
        this.stampGenerated();
        this.state.set({ kind: 'READY', data });
      }
    } catch (err: unknown) {
      console.warn('[AON] order page failed', err);
      if (seq === this.seq) this.state.set({ kind: 'ERROR' });
    }
  }

  /** A figure in the progress band opens the part of the page it summarises. */
  protected go(target: 'qty' | 'time' | 'photos' | 'issues'): void {
    if (target === 'photos') this.tab.set('photos');
    else if (target === 'qty') this.tab.set('log');
    else if (target === 'issues') this.tab.set('over');
    const id = target === 'time' ? 'op-time' : target === 'issues' && this.issues().length ? 'op-issues' : 'op-tabs';
    setTimeout(() => this.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ---- printed order
  protected readonly generated = signal('');
  /** The paper reads top to bottom: oldest day first. */
  protected readonly printDays = computed(() => [...this.days()].reverse());
  /** Photos on paper: two rows, the first of each category before the rest, so the set stays representative. */
  protected readonly printPhotos = computed(() => {
    const groups = this.photoGroups().map((g) => [...g.photos].reverse());
    const out: PhotoView[] = [];
    for (let i = 0; out.length < 8 && groups.some((g) => i < g.length); i++) {
      for (const g of groups) {
        const p = g[i];
        if (p && out.length < 8) out.push(p);
      }
    }
    return out;
  });

  protected crewAll(crew: ReadonlyArray<{ readonly displayName: string }>): string {
    return crew.map((c) => c.displayName).join(', ');
  }

  protected summaryKey(s: string): TranslationKey {
    return `reports.status${s}` as TranslationKey;
  }

  /** Opens the delete dialog, unless the history already shows recorded work: that order is completed, not deleted. */
  protected askDelete(): void {
    const d = this.data();
    if (!d) return;
    if (d.timeEntries.length || d.logs.length || d.photos.length) {
      this.toast.error(this.i18n.t('op.errHasRecords'));
      return;
    }
    this.deleteError.set(null);
    this.deleting.set(true);
  }

  protected async confirmDelete(): Promise<void> {
    const order = this.data()?.order;
    if (!order || this.deleteBusy()) return;
    if (!this.network.online()) {
      this.deleteError.set(this.i18n.t('delete.errOffline'));
      return;
    }
    this.deleteBusy.set(true);
    this.deleteError.set(null);
    try {
      await this.store.deleteOrder(order.id);
      this.deleting.set(false);
      this.toast.success(this.i18n.t('op.deleted', { code: order.code ?? order.title }));
      await this.router.navigateByUrl('/m');
    } catch (err: unknown) {
      console.warn('[AON] order delete failed', err);
      this.deleteError.set(this.i18n.t(err instanceof ApiError && err.kind === 'CONFLICT' ? 'op.errHasRecords' : 'delete.errFailed'));
    } finally {
      this.deleteBusy.set(false);
    }
  }

  protected print(): void {
    this.stampGenerated();
    this.document.defaultView?.print();
  }

  private stampGenerated(): void {
    const now = Date.now();
    this.generated.set(`${this.i18n.dateShort(now)} ${this.i18n.time(now)}`);
  }

  protected stepPhoto(dir: 1 | -1): void {
    const n = this.data()?.photos.length ?? 0;
    const i = this.openPhoto();
    if (i === null || n === 0) return;
    this.openPhoto.set((i + dir + n) % n);
  }

  protected indexOf(p: PhotoView): number {
    return this.data()?.photos.findIndex((x) => x.id === p.id) ?? 0;
  }

  protected workerName(userId: string): string {
    return this.names().get(userId) ?? '–';
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  protected tone(name: string): number {
    return avatarTone(name);
  }

  protected hours(minutes: number): string {
    return `${hm(minutes)} h`;
  }

  protected pct(r: number): number {
    return Math.round(r * 100);
  }

  protected statusKey(s: WorkOrderStatus): TranslationKey {
    return `status.${s}` as TranslationKey;
  }

  protected photoKey(c: PhotoCategory): TranslationKey {
    return `photoCat.${c}` as TranslationKey;
  }

  protected eventIcon(kind: OrderEvent["kind"]): IconName {
    return ({ start: 'play', stop: 'stop', qty: 'plus', fix: 'undo', note: 'note', issue: 'alert', photo: 'camera' } as const)[kind];
  }

  protected eventLabel(e: OrderEvent): string {
    return this.i18n.t(`op.ev.${e.kind}` as TranslationKey);
  }
}
