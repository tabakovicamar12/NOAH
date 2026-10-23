import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { WorkOrderDetailResponse } from '../../core/models/api.models';
import { PHOTO_CATEGORIES, type PhotoCategory, type WorkOrderStatus } from '../../core/models/domain.models';
import { ClockService } from '../../core/ui/clock.service';
import { formatDuration, minutesBetween, toIsoDate } from '../../core/util/util';
import { IconComponent } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { ManagerStore } from './data/manager-store.service';
import { avatarTone, initialsOf } from './person';

type DrillState = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: WorkOrderDetailResponse };

/**
 * The inspector for one work order: status, worker, deadline, hours used against the estimate,
 * materials with any open problem, and the order's history; the daily report is the one action at its foot.
 */
@Component({
  selector: 'aon-order-drill',
  imports: [IconComponent, RouterLink, ReportStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'drill',
    '(document:keydown.escape)': 'onEscape()',
    '(document:keydown.arrowleft)': 'stepPhoto(-1)',
    '(document:keydown.arrowright)': 'stepPhoto(1)',
  },
  template: `
    <div class="vr">
      <div class="sc">
        <header class="hd">
          <div class="hd-row">
            <h2 class="code"><span class="code-k">{{ i18n.t('order.numberKicker') }}</span>{{ detail()?.order?.code ?? code() }}</h2>
            <span class="sp"></span>
            @if (detail(); as d) {
              <a class="ib" [routerLink]="['/m/orders', d.order.id, 'edit']" [attr.aria-label]="i18n.t('drill.edit')" [title]="i18n.t('drill.edit')"><aon-icon name="pencil" [size]="17" /></a>
              <a class="ib" routerLink="/m/orders/new" [queryParams]="{ from: d.order.id }" [attr.aria-label]="i18n.t('drill.duplicate')" [title]="i18n.t('drill.duplicate')"><aon-icon name="copy" [size]="17" /></a>
              <a class="ib" routerLink="/m/report" [queryParams]="{ date: store.date() }" [attr.aria-label]="i18n.t('drill.exportPdf')" [title]="i18n.t('drill.exportPdf')"><aon-icon name="printer" [size]="17" /></a>
            }
            <button type="button" class="ib" [attr.aria-label]="i18n.t('common.close')" (click)="closed.emit()"><aon-icon name="x" [size]="19" [stroke]="1.8" /></button>
          </div>
          @if (detail(); as d) {
            <p class="title">{{ d.order.title }}</p>
            <ol class="steps" [attr.aria-label]="i18n.t('drill.status')">
              @for (st of statusSteps; track st; let i = $index) {
                <li [class.is-done]="i < statusStep()" [class.is-now]="i === statusStep()" [class.is-bad]="i === statusStep() && d.order.status === 'ISSUE'" [class.is-complete]="d.order.status === 'COMPLETED'" [attr.aria-current]="i === statusStep() ? 'step' : null">
                  <span class="st-dot" aria-hidden="true">
                    @if (i < statusStep() || (i === statusStep() && d.order.status === 'COMPLETED')) {
                      <aon-icon name="check" [size]="13" [stroke]="3" />
                    } @else if (i === statusStep() && d.order.status === 'ISSUE') {
                      <aon-icon name="alert" [size]="13" [stroke]="2.5" />
                    }
                  </span>
                  <span class="st-l">{{ i18n.t(statusKey(i === statusStep() && d.order.status === 'ISSUE' ? 'ISSUE' : st)) }}</span>
                </li>
              }
            </ol>
          }
        </header>
        @if (state().kind === 'LOADING') {
          <div class="pad" aria-busy="true">
            <div class="skel" style="height: 1.6rem; width: 55%"></div>
            <div class="skel" style="height: 5.5rem"></div>
            <div class="skel" style="height: 3rem"></div>
            <span class="sr-only">{{ i18n.t('common.loading') }}</span>
          </div>
        } @else if (state().kind === 'ERROR') {
          <div class="pad">
            <p class="alert" role="alert"><aon-icon name="alert" [size]="19" />{{ i18n.t('drill.loadFailed') }}</p>
            <button type="button" class="quiet" style="margin-top: 0.75rem" (click)="reload()"><aon-icon name="retry" [size]="16" />{{ i18n.t('common.retry') }}</button>
          </div>
        }
        @if (detail(); as d) {
          <div class="pad">
            @if (!d.order.published) {
              <p class="note"><aon-icon name="note" [size]="17" />{{ i18n.t('drill.draftNote') }}</p>
            }
            <dl class="facts">
              <div class="fact">
                <dt>{{ i18n.t('drill.worker') }}</dt>
                <dd class="who">
                  @if (d.order.crew.length) {
                    <span class="ava" [attr.data-tone]="tone(d.order.crew[0]?.displayName)" aria-hidden="true">{{ initials(d.order.crew[0]?.displayName) }}</span>
                    <span class="trunc">{{ crewNames() }}</span>
                  } @else {
                    <span class="muted">{{ i18n.t('drill.noWorker') }}</span>
                  }
                </dd>
              </div>
              <div class="fact">
                <dt>{{ i18n.t('drill.due') }}</dt>
                <dd [class.is-late]="isLate()">{{ d.order.dueDate ? i18n.dateShort(d.order.dueDate) : i18n.t('common.none') }}</dd>
              </div>
              <div class="fact">
                <dt>{{ i18n.t('drill.qty') }}</dt>
                @if (d.order.plannedQty > 0) {
                  <dd class="num">{{ i18n.number(d.order.doneQty) }} / {{ i18n.number(d.order.plannedQty) }} {{ i18n.t(unitKey()) }}</dd>
                  <div class="bar" aria-hidden="true"><span [style.width.%]="qtyRatio() * 100"></span></div>
                } @else {
                  <dd>{{ i18n.t('order.noQuantity') }}</dd>
                }
              </div>
              <div class="fact">
                <dt>{{ i18n.t('drill.hoursUsed') }}</dt>
                <dd class="num">{{ d.order.estimatedMinutes ? i18n.t('drill.hoursOf', { done: hours(totalMinutes()), est: hours(d.order.estimatedMinutes) }) : hours(totalMinutes()) }}</dd>
                <div class="bar" aria-hidden="true"><span [style.width.%]="timeRatio() * 100" [class.is-over]="isOver()"></span></div>
              </div>
            </dl>
            @for (l of issues(); track l.id) {
              <p class="alert" role="note">
                <aon-icon name="alert" [size]="19" [stroke]="2" class="alert-ic" />
                <span>{{ l.text }}<span class="alert-meta">{{ workerName(l.userId) }} · {{ i18n.dateShort(l.createdAt) }} {{ i18n.time(l.createdAt) }}</span></span>
              </p>
            }
            <div class="cards">
              <details class="card" [open]="d.order.materials.length > 0">
                <summary><aon-icon name="package" [size]="17" />{{ i18n.t('drill.material') }}<span class="cnt">{{ d.order.materials.length }}</span><aon-icon name="chevron-right" [size]="17" class="chev" /></summary>
                <div class="card-b">
                  @if (d.order.materials.length) {
                    <ul class="mat">
                      @for (m of d.order.materials; track $index) {
                        <li><span>{{ m.name }}</span><span class="muted num">@if (m.qty !== null) {{{ i18n.number(m.qty) }} {{ m.unit }}}</span></li>
                      }
                    </ul>
                  } @else {
                    <p class="muted">{{ i18n.t('common.none') }}</p>
                  }
                </div>
              </details>
              <details class="card">
                <summary><aon-icon name="camera" [size]="17" />{{ i18n.t('drill.photos') }}<span class="cnt">{{ d.photos.length }}</span><aon-icon name="chevron-right" [size]="17" class="chev" /></summary>
                <div class="card-b">
                  @if (d.photos.length === 0) {
                    <p class="muted">{{ i18n.t('photo.none') }}</p>
                  } @else {
                    <ul class="ph">
                      @for (p of d.photos; track p.id) {
                        <li>
                          @if (p.url) {
                            <button type="button" class="ph-i" [class.is-issue]="p.category === 'ISSUE'" [attr.aria-label]="i18n.t('photo.openAria', { category: i18n.t(photoKey(p.category)), time: i18n.time(p.createdAt) })" (click)="openPhoto.set($index)">
                              <img [src]="p.url" alt="" loading="lazy" />
                            </button>
                          } @else {
                            <span class="ph-i ph-empty" [title]="i18n.t('drill.photoMissing')"><aon-icon name="camera" [size]="20" /></span>
                          }
                        </li>
                      }
                    </ul>
                  }
                </div>
              </details>
              <details class="card">
                <summary><aon-icon name="clock" [size]="17" />{{ i18n.t('drill.time') }}<span class="cnt num">{{ duration(totalMinutes()) }}</span><aon-icon name="chevron-right" [size]="17" class="chev" /></summary>
                <div class="card-b">
                  @if (segments().length === 0) {
                    <p class="muted">{{ i18n.t('drill.noTime') }}</p>
                  } @else {
                    <ol class="rows">
                      @for (s of segments(); track s.id) {
                        <li class="line">
                          <span>
                            <span class="row-main">{{ workerName(s.userId) }}</span>
                            <span class="row-sub">{{ i18n.dateShort(s.date) }} · {{ i18n.time(s.startedAt) }}–{{ s.endedAt ? i18n.time(s.endedAt) : i18n.t('drill.running') }}</span>
                            @if (s.endSource === 'DECLARED') {
                              <span class="row-bad">{{ i18n.t('drill.declared') }}</span>
                            }
                          </span>
                          <span class="num">{{ s.duration }}</span>
                        </li>
                      }
                    </ol>
                  }
                </div>
              </details>
              <details class="card">
                <summary><aon-icon name="note" [size]="17" />{{ i18n.t('drill.notes') }}<span class="cnt">{{ notes().length }}</span><aon-icon name="chevron-right" [size]="17" class="chev" /></summary>
                <div class="card-b">
                  @if (notes().length === 0) {
                    <p class="muted">{{ i18n.t('drill.noNotes') }}</p>
                  } @else {
                    <ol class="rows">
                      @for (l of notes(); track l.id) {
                        <li class="line">
                          <span>
                            <span class="row-sub">{{ workerName(l.userId) }} · {{ i18n.dateShort(l.createdAt) }} · {{ i18n.time(l.createdAt) }}</span>
                            @if (l.kind === 'QUANTITY' && (l.quantity ?? 0) < 0) {
                              <span class="row-main is-fix">{{ i18n.t('order.logCorrection', { q: i18n.number(-(l.quantity ?? 0)), unit: i18n.t(unitKey()) }) }}</span>
                            } @else if (l.kind === 'QUANTITY') {
                              <span class="row-main">{{ i18n.t('order.logQuantity', { q: i18n.number(l.quantity ?? 0), unit: i18n.t(unitKey()) }) }}</span>
                            }
                            @if (l.text) {
                              <span class="row-text">{{ l.text }}</span>
                            }
                          </span>
                        </li>
                      }
                    </ol>
                  }
                </div>
              </details>
              <details class="card">
                <summary><aon-icon name="report" [size]="17" />{{ i18n.t('drill.summaries') }}<span class="cnt">{{ d.summaries.length }}</span><aon-icon name="chevron-right" [size]="17" class="chev" /></summary>
                <div class="card-b">
                  @if (d.summaries.length === 0) {
                    <p class="muted">{{ i18n.t('drill.noSummaries') }}</p>
                  } @else {
                    <ul class="rows">
                      @for (s of d.summaries; track s.id) {
                        <li>
                          <button type="button" class="row" (click)="openReport.emit(s.id)">
                            <span><span class="row-main">{{ workerName(s.userId) }}</span><span class="row-sub">{{ i18n.date(s.date) }} · {{ duration(s.shiftMinutes) }}</span></span>
                            <span class="row-end"><aon-report-status [status]="s.status" /><aon-icon name="chevron-right" [size]="17" /></span>
                          </button>
                        </li>
                      }
                    </ul>
                  }
                </div>
              </details>
            </div>
          </div>
          @if (openPhoto() !== null && d.photos[openPhoto() ?? 0]; as ph) {
            <div class="lb" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t(photoKey(ph.category))" (click)="openPhoto.set(null)">
              <figure class="lb-fig" (click)="$event.stopPropagation()">
                @if (ph.url) {
                  <img [src]="ph.url" [alt]="i18n.t('photo.alt', { category: i18n.t(photoKey(ph.category)), code: d.order.code ?? '' })" />
                }
                <figcaption>
                  <span>{{ i18n.t(photoKey(ph.category)) }} · {{ ph.userName }} · {{ i18n.dateShort(ph.createdAt) }} {{ i18n.time(ph.createdAt) }}</span>
                  <span class="num">{{ (openPhoto() ?? 0) + 1 }} / {{ d.photos.length }}</span>
                </figcaption>
              </figure>
              @if (d.photos.length > 1) {
                <button type="button" class="lb-btn lb-prev" [attr.aria-label]="i18n.t('photo.prev')" (click)="$event.stopPropagation(); stepPhoto(-1)"><aon-icon name="chevron-left" [size]="26" /></button>
                <button type="button" class="lb-btn lb-next" [attr.aria-label]="i18n.t('photo.next')" (click)="$event.stopPropagation(); stepPhoto(1)"><aon-icon name="chevron-right" [size]="26" /></button>
              }
              <button type="button" class="lb-btn lb-close" [attr.aria-label]="i18n.t('common.close')" (click)="openPhoto.set(null)"><aon-icon name="x" [size]="22" /></button>
            </div>
          }
        }
      </div>
      <div class="ft">
        <button type="button" class="gold" [disabled]="!latestReport()" [title]="latestReport() ? '' : i18n.t('drill.noReport')" (click)="openLatestReport()">
          <aon-icon name="file" [size]="19" [stroke]="1.8" />{{ i18n.t('drill.dailyReport') }}
        </button>
        @if (detail() && !latestReport()) {
          <p class="ft-note">{{ i18n.t('drill.noReport') }}</p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .vr {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      font-size: 1.05rem;
      line-height: 1.4;
    }
    .sc {
      flex: 1 1 auto;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .pad {
      padding: 0.25rem 1.4rem 1.4rem;
    }
    .hd-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .sp {
      flex: 1 1 auto;
    }
    .ib {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.45rem;
      color: var(--color-text-muted);
      transition: background-color 140ms ease-out, color 140ms ease-out;
    }
    .ib:hover {
      background: var(--color-field);
      color: var(--color-text);
    }
    .code-k {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.72rem;
      font-weight: 650;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .code {
      white-space: nowrap;
      font-size: 1.4rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.15;
      font-variant-numeric: normal;
    }
    .title {
      font-size: 1.12rem;
      font-weight: 500;
      line-height: 1.35;
    }
    .muted {
      color: var(--color-text-muted);
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .trunc {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .is-late {
      color: var(--color-bad);
      font-weight: 600;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      height: 1.7rem;
      padding: 0 0.6rem;
      border-radius: 9999px;
      font-size: 0.92rem;
      font-weight: 500;
      white-space: nowrap;
    }
    .badge[data-s='NEW'] { background: var(--color-new-tint); color: var(--color-new-ink); }
    .badge[data-s='IN_PROGRESS'] { background: var(--color-blue-tint); color: var(--color-blue); }
    .badge[data-s='COMPLETED'] { background: var(--color-ok-tint); color: var(--color-ok-ink); }
    .badge[data-s='ISSUE'] { background: var(--color-bad-tint); color: var(--color-bad); text-transform: uppercase; letter-spacing: 0.02em; }
    .ava {
      display: grid;
      place-items: center;
      width: 1.9rem;
      height: 1.9rem;
      flex: 0 0 auto;
      border-radius: 9999px;
      background: #5d6f93;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .ava.sm { width: 1.45rem; height: 1.45rem; font-size: 0.66rem; }
    .ava[data-tone='1'] { background: #b9984a; }
    .ava[data-tone='2'] { background: #a85a55; }
    .ava[data-tone='3'] { background: #4f7a72; }
    .ava[data-tone='4'] { background: #7b6a94; }
    .bar {
      height: 0.4rem;
      margin-top: 0.4rem;
      overflow: hidden;
      border-radius: 9999px;
      background: var(--color-track);
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-progress);
      transition: width 500ms var(--ease-out-expo);
    }
    .bar span.is-over { background: var(--color-bad); }
    .alert {
      display: flex;
      gap: 0.6rem;
      margin-top: 0.75rem;
      padding: 0.65rem 0.85rem;
      border: 1px solid #ef9a9a;
      border-radius: 0.6rem;
      background: #fdeced;
      color: var(--color-bad-ink);
      line-height: 1.35;
    }
    .alert-ic { flex: 0 0 auto; margin-top: 0.1rem; color: #d62828; }
    .alert-meta { display: block; margin-top: 0.2rem; font-size: 0.85rem; opacity: 0.8; }
    .note {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding: 0.6rem 0.8rem;
      border-radius: 0.5rem;
      background: var(--color-field);
      font-size: 0.95rem;
    }
    .quiet {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.25rem;
      padding: 0 0.7rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.45rem;
      font-weight: 500;
    }
    .skel {
      margin-top: 0.8rem;
      border-radius: 0.5rem;
      background: var(--color-field);
    }
    .sec { margin-top: 1.35rem; }
    .sec-h {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 0.45rem;
      font-size: 1rem;
      font-weight: 600;
    }
    .sub-h {
      margin-top: 1rem;
      margin-bottom: 0.2rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      font-weight: 500;
    }
    .mat li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.45rem 0;
      border-bottom: 1px solid var(--color-line);
      font-size: 0.97rem;
    }
    .mat li:last-child { border-bottom: 0; }
    .ph {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.4rem;
    }
    .ph-i {
      display: grid;
      place-items: center;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 0.5rem;
      background: var(--color-field);
      color: var(--color-text-muted);
    }
    .ph-i img { width: 100%; height: 100%; object-fit: cover; }
    .ph-i.is-issue { box-shadow: 0 0 0 2px var(--color-bad); }
    .rows > li + li { border-top: 1px solid var(--color-line); }
    .row {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 3rem;
      text-align: left;
    }
    .row:hover { background: var(--color-row-tint); }
    .row-end { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--color-text-muted); }
    .line {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.5rem 0;
      font-size: 0.95rem;
    }
    .row-main { display: block; font-weight: 500; }
    .row-sub { display: block; color: var(--color-text-muted); font-size: 0.87rem; }
    .row-text { display: block; }
    .row-bad { display: block; color: var(--color-bad-ink); font-size: 0.87rem; font-weight: 500; }
    .fold { margin-top: 1.35rem; border-top: 1px solid var(--color-line); }
    .fold summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 2.9rem;
      font-weight: 600;
      cursor: pointer;
      list-style: none;
    }
    .fold summary::-webkit-details-marker { display: none; }
    .chev { color: var(--color-text-muted); transition: transform 180ms var(--ease-out-expo); }
    .fold[open] .chev { transform: rotate(90deg); }
    .ft {
      flex: 0 0 auto;
      padding: 0.9rem 1.4rem 1.2rem;
      border-top: 1px solid var(--color-line);
      background: var(--color-panel);
    }
    .gold {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-height: 2.85rem;
      border-radius: 0.55rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 600;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12), inset 0 -2px 0 rgb(0 0 0 / 0.08);
      transition: filter 160ms ease-out, transform 120ms ease-out;
    }
    .gold:not(:disabled):hover { filter: brightness(1.04); }
    .gold:not(:disabled):active { transform: translateY(1px); }
    .gold:disabled { cursor: not-allowed; opacity: 0.55; }
    .ft-note { margin-top: 0.4rem; color: var(--color-text-muted); font-size: 0.87rem; text-align: center; }

    .ph-i { width: 100%; cursor: zoom-in; transition: transform 160ms ease-out, box-shadow 160ms ease-out; }
    .ph-i:hover { transform: translateY(-1px); box-shadow: 0 6px 14px -8px rgb(20 20 20 / 0.45); }
    .facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.85rem 1rem;
      padding: 0.95rem 1rem;
      border-radius: 0.75rem;
      background: var(--color-field);
    }
    .fact { min-width: 0; }
    .fact dt { color: var(--color-text-muted); font-size: 0.85rem; }
    .fact dd { margin-top: 0.2rem; font-weight: 600; }
    .who { display: flex; align-items: center; gap: 0.45rem; min-width: 0; font-weight: 500 !important; }
    .where { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.2rem; color: var(--color-text-muted); font-size: 0.92rem; }
    .sec-h { margin-top: 1.3rem; }
    .sec-h .muted { font-weight: 400; font-size: 0.9rem; }
    .cnt {
      min-width: 1.35rem;
      padding: 0 0.4rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text-muted);
      font-size: 0.78rem;
      font-weight: 500;
      text-align: center;
    }
    /* Lightbox: one photo at a time, arrows and Esc work. */
    .lb {
      position: fixed;
      inset: 0;
      z-index: 120;
      display: grid;
      place-items: center;
      padding: 3.5rem 4.5rem;
      background: rgb(20 20 20 / 0.86);
      animation: v-fade 180ms ease-out;
    }
    .lb-fig { display: grid; gap: 0.6rem; max-width: min(72rem, 100%); max-height: 100%; }
    .lb-fig img { max-width: 100%; max-height: calc(100dvh - 9rem); border-radius: 0.5rem; object-fit: contain; background: #111; }
    .lb-fig figcaption { display: flex; justify-content: space-between; gap: 1rem; color: #ecebe7; font-size: 0.93rem; }
    .lb-btn {
      position: absolute;
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border-radius: 9999px;
      background: rgb(255 255 255 / 0.1);
      color: #fff;
      transition: background-color 140ms ease-out;
    }
    .lb-btn:hover { background: rgb(255 255 255 / 0.2); }
    .lb-prev { left: 1rem; top: 50%; translate: 0 -50%; }
    .lb-next { right: 1rem; top: 50%; translate: 0 -50%; }
    .lb-close { top: 1rem; right: 1rem; }
    @keyframes v-fade { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .lb { animation: none !important; }
    }

    .vr { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .hd { padding: 1.15rem 1.4rem 1rem; border-bottom: 1px solid var(--color-line); }
    .hd .title { display: block; margin-top: 0.3rem; }
    .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 1rem; }
    .steps li { position: relative; display: grid; justify-items: center; gap: 0.35rem; text-align: center; }
    .steps li + li::before {
      content: '';
      position: absolute;
      top: 0.7rem;
      right: calc(50% + 0.85rem);
      left: calc(-50% + 0.85rem);
      height: 2px;
      border-radius: 2px;
      background: var(--color-line);
    }
    .steps li.is-done + li::before,
    .steps li.is-done + li.is-now::before { background: var(--color-progress); }
    .st-dot {
      display: grid;
      place-items: center;
      width: 1.45rem;
      height: 1.45rem;
      border: 2px solid var(--color-line-strong);
      border-radius: 9999px;
      background: var(--color-panel);
      color: #fff;
    }
    .is-done .st-dot { border-color: var(--color-progress); background: var(--color-progress); color: var(--color-charcoal); }
    .is-now .st-dot { border-color: var(--color-blue); background: var(--color-blue); box-shadow: 0 0 0 4px var(--color-blue-tint); }
    /* A finished order: the whole path is done, and the last step reads as finished, not current. */
    .is-complete .st-dot {
      border-color: var(--color-ok);
      background: var(--color-ok);
      color: #fff;
      box-shadow: none;
    }
    .is-complete + .is-complete::before {
      background: var(--color-ok) !important;
    }
    .is-bad .st-dot { border-color: var(--color-bad); background: var(--color-bad); box-shadow: 0 0 0 4px var(--color-bad-tint); }
    .st-l { color: var(--color-text-muted); font-size: 0.85rem; }
    .is-now .st-l, .is-done .st-l { color: var(--color-text); font-weight: 500; }
    .is-bad .st-l { color: var(--color-bad); font-weight: 600; }
    .pad { padding-top: 1rem; }
    .cards { display: grid; gap: 0.55rem; margin-top: 1.1rem; }
    .card { border: 1px solid var(--color-line); border-radius: 0.7rem; background: var(--color-panel); transition: box-shadow 160ms ease-out; }
    .card[open] { box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 10px 24px -20px rgb(20 20 20 / 0.35); }
    .card summary {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-height: 2.9rem;
      padding: 0 0.85rem;
      font-weight: 600;
      cursor: pointer;
      list-style: none;
    }
    .card summary::-webkit-details-marker { display: none; }
    .card summary .chev { margin-left: 0.15rem; }
    .card summary .cnt { margin-left: auto; }
    .card[open] .chev { transform: rotate(90deg); }
    .card-b { padding: 0 0.85rem 0.85rem; }
  `,
})
export class OrderDrillComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ManagerStore);
  private readonly clock = inject(ClockService);

  readonly orderId = input.required<string>();
  readonly code = input<string>('');
  readonly closed = output<void>();
  readonly openReport = output<string>();

  protected readonly state = signal<DrillState>({ kind: 'LOADING' });
  private seq = 0;

  protected readonly detail = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });

  private readonly names = computed(() => {
    const map = new Map<string, string>();
    for (const w of this.store.overview()?.workers ?? []) map.set(w.user.id, w.user.displayName);
    for (const c of this.detail()?.order.crew ?? []) map.set(c.id, c.displayName);
    return map;
  });

  protected readonly crewNames = computed(() => (this.detail()?.order.crew ?? []).map((c) => c.displayName).join(', '));

  private readonly orderEntries = computed(() => (this.detail()?.timeEntries ?? []).filter((e) => e.kind === 'ORDER'));

  protected readonly segments = computed(() => {
    const now = this.clock.now();
    return this.orderEntries().map((e) => ({ ...e, duration: formatDuration(minutesBetween(e.startedAt, e.endedAt ?? now)) }));
  });

  protected readonly totalMinutes = computed(() => {
    const now = this.clock.now();
    return this.orderEntries().reduce((sum, e) => sum + minutesBetween(e.startedAt, e.endedAt ?? now), 0);
  });

  protected readonly timeRatio = computed(() => {
    const est = this.detail()?.order.estimatedMinutes ?? 0;
    return est > 0 ? Math.min(1, this.totalMinutes() / est) : 0;
  });

  protected readonly isOver = computed(() => {
    const est = this.detail()?.order.estimatedMinutes ?? 0;
    return est > 0 && this.totalMinutes() > est;
  });

  protected readonly issues = computed(() => (this.detail()?.logs ?? []).filter((l) => l.kind === 'ISSUE'));
  protected readonly notes = computed(() => (this.detail()?.logs ?? []).filter((l) => l.kind !== 'ISSUE'));
  protected readonly unitKey = computed(() => `unit.${this.detail()?.order.unit ?? 'PCS'}` as const);

  protected readonly latestReport = computed(() => {
    const s = this.detail()?.summaries ?? [];
    return s.length ? [...s].sort((a, b) => (a.date < b.date ? 1 : -1))[0] : null;
  });

  /** Index of the photo open in the lightbox, or null. */
  protected readonly openPhoto = signal<number | null>(null);
  protected readonly statusSteps: readonly WorkOrderStatus[] = ['NEW', 'IN_PROGRESS', 'COMPLETED'];
  protected readonly statusStep = computed(() => {
    const s = this.detail()?.order.status;
    return s === 'COMPLETED' ? 2 : s === 'IN_PROGRESS' || s === 'ISSUE' ? 1 : 0;
  });
  protected readonly qtyRatio = computed(() => {
    const o = this.detail()?.order;
    return o && o.plannedQty > 0 ? Math.min(1, o.doneQty / o.plannedQty) : 0;
  });
  /** Past its deadline and not finished. */
  protected readonly isLate = computed(() => {
    const o = this.detail()?.order;
    return !!o?.dueDate && o.status !== 'COMPLETED' && o.dueDate < toIsoDate();
  });

  protected stepPhoto(dir: 1 | -1): void {
    const n = this.detail()?.photos.length ?? 0;
    const i = this.openPhoto();
    if (i === null || n === 0) return;
    this.openPhoto.set((i + dir + n) % n);
  }

  /** Esc closes an open photo first, then the details. */
  protected onEscape(): void {
    if (this.openPhoto() !== null) this.openPhoto.set(null);
    else this.closed.emit();
  }

  constructor() {
    effect(() => {
      const id = this.orderId();
      untracked(() => void this.fetch(id));
    });
  }

  protected workerName(userId: string): string {
    return this.names().get(userId) ?? userId;
  }

  protected initials(name: string | undefined): string {
    return initialsOf(name ?? '');
  }

  protected tone(name: string | undefined): number {
    return avatarTone(name ?? '');
  }

  protected duration(minutes: number): string {
    return formatDuration(minutes);
  }

  protected hours(minutes: number): string {
    return `${this.i18n.number(Math.round((minutes / 60) * 10) / 10)} h`;
  }

  protected openLatestReport(): void {
    const r = this.latestReport();
    if (r) this.openReport.emit(r.id);
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
