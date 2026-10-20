import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { QuantityUnit, WorkOrderStatus } from '../../core/models/domain.models';
import { ClockService } from '../../core/ui/clock.service';
import { ToastService } from '../../core/ui/toast.service';
import { compareCodes, formatDuration, toIsoDate } from '../../core/util/util';
import { BlobUrls } from '../../shared/ui/blob-urls';
import { IconComponent } from '../../shared/ui/icon.component';
import { progressRatio } from '../../shared/ui/tag-style';
import { WorkerStore } from './data/worker-store.service';
import { orderElapsedMs, startedMessage, workflowMessage } from './data/workflow-messages';

/** `YYYY-MM-DDTHH:MM` in local time, for datetime-local inputs. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Component({
  selector: 'aon-worker-orders',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="col-lead">
      @if (store.staleShift(); as stale) {
        <!-- A shift left running from an earlier day: the real end is declared, never tapped now. -->
        <section class="card stale" aria-labelledby="stale-title">
          <h2 id="stale-title" class="stale-title"><aon-icon name="clock" [size]="22" />{{ i18n.t('stale.title', { date: i18n.date(stale.startedAt) }) }}</h2>
          <p class="mt-2 leading-snug">{{ i18n.t('stale.body', { time: i18n.time(stale.startedAt) }) }}</p>
          <label class="mt-3 block">
            <span class="field-label">{{ i18n.t('stale.endLabel') }}</span>
            <input
              type="datetime-local"
              class="field"
              [min]="staleMin()"
              [max]="staleMax()"
              [value]="staleEnd() || staleDefault()"
              (input)="staleEnd.set($any($event.target).value)"
            />
          </label>
          <label class="mt-3 block">
            <span class="field-label">{{ i18n.t('stale.reasonLabel') }}</span>
            <textarea
              rows="2"
              maxlength="500"
              class="field field-area"
              [placeholder]="i18n.t('stale.reasonPlaceholder')"
              [value]="staleReason()"
              (input)="staleReason.set($any($event.target).value)"
            ></textarea>
          </label>
          <button type="button" class="btn btn-dark mt-3" [disabled]="busy()" (click)="declareEnd()">
            <aon-icon name="check" [size]="20" [stroke]="2.5" />{{ i18n.t('stale.submit') }}
          </button>
          <p class="muted mt-2 flex items-start gap-2 text-sm"><aon-icon name="shield" [size]="16" class="mt-0.5" />{{ i18n.t('stale.flagged') }}</p>
        </section>
      } @else {
        <!-- The day, in the dark: greeting, the shift clock and the one thing to do now. -->
        <section class="hero" [attr.aria-label]="i18n.t('shift.todayTotal')">
          <img class="hero-img" src="/plates/home-drawing.jpg" alt="" width="1024" height="688" decoding="async" />
          <p class="h-hello">{{ greeting() }}</p>
          <p class="h-clock">
            <span class="h-timer num" role="timer" [attr.aria-label]="shiftClock().aria">{{ shiftClock().text }}</span>
            <span class="h-state">
              @if (store.openShift(); as shift) {
                {{ i18n.t('shift.onSince', { time: i18n.time(shift.startedAt) }) }}@if (store.shiftSiteName(); as site) {<span class="h-site"> · {{ site }}</span>}
              } @else if (store.lastEndedShift(); as ended) {
                {{ i18n.t('shift.endedAt', { time: i18n.time(ended.endedAt) }) }}
              } @else {
                {{ i18n.t('shift.notStarted') }}
              }
            </span>
          </p>
          <!-- Where the day stands: start, work, report; and the one thing to do now. -->
          <div class="h-next">
            <div class="hn-row" aria-hidden="true">
              @for (i of [0, 1, 2]; track i) {
                <span class="hn-s" [class.is-done]="i < dayStep()" [class.is-now]="i === dayStep()"></span>
              }
            </div>
            <p class="hn-t"><span class="hn-n">{{ dayStep() < 3 ? dayStep() + 1 : 3 }} / 3</span>{{ i18n.t(nextStep().key, nextStep().params) }}</p>
          </div>
          @if (!store.openShift()) {
            <p class="h-note"><aon-icon name="shield" [size]="13" />{{ i18n.t('shift.noGps') }}</p>
          }
        </section>
      }
      @if (store.summary(); as s) {
        @if (s.status === 'RETURNED') {
          <a routerLink="/w/day" class="returned">
            <span class="ret-row"><aon-icon name="alert" [size]="20" />{{ i18n.t('day.returnedBanner') }}<aon-icon name="chevron-right" [size]="20" class="ret-chev" /></span>
            @if (s.reviewerNote) {
              <span class="ret-note">»{{ s.reviewerNote }}«</span>
            }
          </a>
        }
      }
      @if (reportDue() && !store.openShift() && store.summary()?.status !== 'RETURNED') {
        <a routerLink="/w/day" class="report"><aon-icon name="file" [size]="20" />{{ i18n.t('day.close') }}<aon-icon name="chevron-right" [size]="20" class="ret-chev" /></a>
      }
      @if (store.activeOrder(); as order) {
        <section class="act" aria-labelledby="h-active" [attr.data-order]="order.id" [style.view-transition-name]="morphId() === order.id ? 'order-morph' : null">
          <div class="act-top">
            <span class="chip"><span class="live" aria-hidden="true"></span>{{ i18n.t('orders.running') }} · <span class="num">{{ activeClock().hm }}</span></span>
            <span class="act-code">{{ order.code }}</span>
          </div>
          <div>
            <h2 id="h-active" class="act-title">
              <a [routerLink]="['/w/orders', order.id]" [attr.aria-label]="i18n.t('orders.open', { code: order.code ?? '' }) + ' · ' + order.title">{{ order.title }}</a>
            </h2>
            <p class="act-site">
              {{ order.siteName || order.location }}@if (dueLabel(order); as due) {<span class="due" [class.is-late]="due.late"> · {{ due.text }}</span>}
            </p>
          </div>
          <div class="act-qty">
            <span class="bar" role="img" [attr.aria-label]="i18n.t('order.progress', { done: i18n.number(order.doneQty), planned: i18n.number(order.plannedQty), unit: i18n.t(unitKey(order.unit)) })"><span [style.width.%]="ratio(order) * 100"></span></span>
            <b class="num">{{ i18n.number(order.doneQty) }} / {{ i18n.number(order.plannedQty) }} {{ i18n.t(unitKey(order.unit)) }}</b>
          </div>
          <div class="tools4">
            @for (p of activePhotos(); track p.id) {
              <a class="tile thumb" [routerLink]="['/w/orders', order.id]" fragment="photos" [attr.aria-label]="i18n.t('home.photoOf', { code: order.code ?? '' })">
                <img [src]="p.url" alt="" />
              </a>
            }
            <a class="tile add" [class.span2]="activePhotos().length < 2" [routerLink]="['/w/orders', order.id]" fragment="photos" [attr.aria-label]="i18n.t('photo.take')">
              <aon-icon name="camera" [size]="22" />
              @if (activePhotos().length < 2) {<span>{{ i18n.t('worker.photo') }}</span>}
            </a>
            <a class="tile note" [class.span2]="activePhotos().length === 0" [routerLink]="['/w/orders', order.id]" fragment="note" [attr.aria-label]="i18n.t('worker.noteOrIssue')">
              <aon-icon name="note" [size]="20" />
              <span>{{ i18n.t('home.noteShort') }}</span>
            </a>
          </div>
          <div class="plus-wrap">
          @for (fx of plusFx(); track fx) {
            <span class="fx" aria-hidden="true">+1 {{ i18n.t(unitKey(order.unit)) }}</span>
          }
          <button type="button" class="plus" [disabled]="busy()" (click)="addOne(order.id)"><aon-icon name="plus" [size]="22" [stroke]="2.8" />1 {{ i18n.t(unitKey(order.unit)) }}</button>
          </div>
        </section>
      }
      </div>
      <div class="col-list">
      <h2 class="list-title">{{ store.activeOrder() ? i18n.t('home.nextOrders') : i18n.t('orders.title') }}<span class="cnt">{{ listOrders().length }}</span></h2>
      @if (store.refreshFailed()) {
        <p class="note-line" role="status"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('orders.loadFailed') }}</p>
      }
      @if (store.orders().length === 0) {
        <div class="card">
          <p class="strong">{{ i18n.t('orders.empty') }}</p>
          <p class="muted mt">{{ i18n.t('orders.emptyHint') }}</p>
        </div>
      }
      @if (listOrders().length) {
        @if (listOrders().length > 4) {
          <div class="tools">
            <label class="search">
              <span class="sr-only">{{ i18n.t('home.search') }}</span>
              <aon-icon name="search" [size]="17" />
              <input type="search" [placeholder]="i18n.t('home.search')" [value]="orderQuery()" (input)="orderQuery.set($any($event.target).value); showAll.set(false)" />
            </label>
            <div class="flt sorter" role="group" [attr.aria-label]="i18n.t('home.sort')">
              <button type="button" class="flt-btn" [attr.aria-pressed]="orderSort() === 'due'" (click)="orderSort.set('due')">{{ i18n.t('home.sortDue') }}</button>
              <button type="button" class="flt-btn" [attr.aria-pressed]="orderSort() === 'code'" (click)="orderSort.set('code')">{{ i18n.t('home.sortCode') }}</button>
            </div>
          </div>
        }
        <ul class="nexts">
          @for (o of shownOrders(); track o.id) {
            <li class="nx" [class.is-bad]="o.status === 'ISSUE'" [style.view-transition-name]="morphId() === o.id ? 'order-morph' : null">
              <a [routerLink]="['/w/orders', o.id]" class="nx-main" [attr.aria-label]="i18n.t('orders.open', { code: o.code ?? '' }) + ' · ' + o.title + ' · ' + i18n.t(statusKey(o.status))">
                <span class="nx-title">{{ o.title }}</span>
                <span class="nx-meta">
                  <span class="nx-code">{{ o.code }}</span>
                  @if (o.status === 'ISSUE') {
                    <span class="nx-flag">{{ i18n.t(statusKey(o.status)) }}</span>
                  }
                  <span class="num">{{ i18n.number(o.doneQty) }} / {{ i18n.number(o.plannedQty) }} {{ i18n.t(unitKey(o.unit)) }}</span>
                  @if (dueLabel(o); as due) {
                    <span class="due" [class.is-late]="due.late">{{ due.text }}</span>
                  }
                </span>
                @if (o.doneQty > 0) {
                  <span class="mini" aria-hidden="true"><span [style.width.%]="ratio(o) * 100"></span></span>
                }
              </a>
              @if (o.status === 'ISSUE') {
                <span class="nx-go is-bad" aria-hidden="true"><aon-icon name="alert" [size]="19" [stroke]="2.2" /></span>
              } @else {
                <button type="button" class="nx-go" [class.is-off]="!store.openShift() || store.dayClosed()" [disabled]="busy()" [attr.aria-label]="i18n.t('home.startOrder', { code: o.code ?? '' })" (click)="startOrder(o.id)">
                  <aon-icon name="play" [size]="18" [stroke]="2.4" />
                </button>
              }
            </li>
          } @empty {
            <li class="none">{{ i18n.t('home.noMatch') }}</li>
          }
        </ul>
        @if (!showAll() && matchingOrders().length > 6) {
          <p class="more"><button type="button" (click)="showAll.set(true)">{{ i18n.t('home.showAll', { n: matchingOrders().length }) }}<aon-icon name="chevron-down" [size]="17" /></button></p>
        } @else if (showAll() && matchingOrders().length > 6) {
          <p class="more"><button type="button" (click)="showAll.set(false)">{{ i18n.t('home.showLess') }}<aon-icon name="chevron-up" [size]="17" /></button></p>
        }
      }
      @if (groups().done.length) {
        <details class="fold">
          <summary>{{ i18n.t('home.groupDone') }}<span class="cnt">{{ groups().done.length }}</span><aon-icon name="chevron-right" [size]="18" class="chev" /></summary>
          <ul class="list">
            @for (o of groups().done; track o.id) {
              <li>
                <a [routerLink]="['/w/orders', o.id]" class="row" [attr.aria-label]="i18n.t('orders.open', { code: o.code ?? '' }) + ' · ' + i18n.t(statusKey(o.status))">
                  <span class="row-main">
                    <span class="row-title"><span class="code">{{ o.code }}</span> {{ o.title }}</span>
                    @if (o.siteName) {
                      <span class="row-meta"><span class="trunc">{{ o.siteName }}</span></span>
                    }
                  </span>
                  <span class="row-end">
                    @if (o.dirty === 1) {
                      <aon-icon name="refresh" [size]="14" class="muted" [attr.aria-hidden]="true" />
                    }
                    <span class="pill" [attr.data-s]="o.status">{{ i18n.t(statusKey(o.status)) }}</span>
                    <aon-icon name="chevron-right" [size]="18" class="muted" />
                  </span>
                </a>
              </li>
            }
          </ul>
        </details>
      }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    /* Home: the day in a dark band under the bar, the running order, the next orders as rows. */
    .page { padding: 0 0.875rem 0.5rem; }
    .card {
      margin-top: 0.8rem;
      border-radius: 1rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 8px 22px -16px rgb(20 20 20 / 0.3);
      padding: 0.9rem 0.875rem;
    }
    .num { font-variant-numeric: tabular-nums; }
    .muted { color: var(--color-text-muted); }
    .strong { font-weight: 600; }
    .mt { margin-top: 0.25rem; }
    .code { font-weight: 600; letter-spacing: -0.01em; }
    .trunc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cnt {
      min-width: 1.4rem;
      padding: 0 0.4rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text-muted);
      font-size: 0.8rem;
      font-weight: 600;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .btn {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border-radius: 0.6rem;
      font-size: 1rem;
      font-weight: 600;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-dark { background: var(--color-rail); color: #fff; }

    /* The dark band continues the bar above it and closes in a soft curve. */
    .hero {
      position: relative;
      overflow: hidden;
      isolation: isolate;
      margin: 0 -0.875rem;
      padding: 0.55rem 1rem 1.2rem;
      border-radius: 0 0 1.6rem 1.6rem;
      background: var(--color-rail);
      color: #ecebe7;
    }
    .hero-img {
      position: absolute;
      right: -1.25rem;
      bottom: -0.6rem;
      z-index: -1;
      width: 15rem;
      height: 9.4rem;
      object-fit: contain;
      opacity: 0.22;
      filter: invert(1);
      /* inverted paper turns black, and screen drops black: only the lines remain */
      mix-blend-mode: screen;
      pointer-events: none;
    }
    .h-hello { color: #a8a6a0; font-size: 0.92rem; }
    .h-clock { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2rem 0.6rem; margin-top: 0.15rem; }
    .h-timer { color: #fff; font-size: 2.85rem; font-weight: 650; letter-spacing: -0.03em; line-height: 1; }
    .h-state { color: #a8a6a0; font-size: 0.98rem; font-weight: 500; }
    .h-next { display: grid; gap: 0.55rem; margin-top: 0.85rem; }
    .hn-row { display: flex; align-items: center; gap: 0.35rem; }
    .hn-s { position: relative; flex: 1 1 0; height: 0.3rem; overflow: hidden; border-radius: 9999px; background: rgb(255 255 255 / 0.14); }
    /* the day's progress fills in when a step is reached */
    .hn-s::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--color-gold); transform: scaleX(0); transform-origin: left; transition: transform 700ms cubic-bezier(0.16, 1, 0.3, 1); }
    .hn-s.is-now::after { transform: scaleX(0.5); }
    .hn-s.is-done::after { transform: scaleX(1); }
    .hn-t { display: flex; align-items: baseline; gap: 0.5rem; color: #ecebe7; font-size: 0.95rem; line-height: 1.35; }
    .hn-n { flex: 0 0 auto; color: var(--color-gold); font-size: 0.78rem; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
    .h-note { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.55rem; color: #8f8d87; font-size: 0.76rem; }

    .returned { display: block; margin-top: 0.8rem; padding: 0.75rem 0.875rem; border: 1px solid #ef9a9a; border-radius: 1rem; background: #fdeced; color: var(--color-bad-ink); text-decoration: none; }
    .ret-row { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; }
    .ret-chev { margin-left: auto; }
    .ret-note { display: block; margin-top: 0.25rem; line-height: 1.35; }
    .report {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-height: 3.6rem;
      margin-top: 0.8rem;
      padding: 0 1rem;
      border-radius: 1rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 700;
      text-decoration: none;
      box-shadow: inset 0 0 0 2px var(--color-gold), 0 8px 22px -16px rgb(20 20 20 / 0.3);
    }

    /* The running order: everything for the next hour in one card. */
    .act {
      display: grid;
      gap: 0.8rem;
      margin-top: 0.8rem;
      padding: 1rem;
      border-radius: 1.25rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 14px 28px -20px rgb(20 20 20 / 0.45);
    }
    .act-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .chip { display: inline-flex; align-items: center; gap: 0.4rem; height: 1.75rem; padding: 0 0.65rem; border-radius: 9999px; background: var(--color-blue-tint); color: var(--color-blue); font-size: 0.78rem; font-weight: 700; }
    .live { width: 0.5rem; height: 0.5rem; border-radius: 9999px; background: var(--color-blue); box-shadow: 0 0 0 0 rgb(31 79 163 / 0.45); animation: pulse 1.8s ease-out infinite; }
    @keyframes pulse { 70% { box-shadow: 0 0 0 0.4rem rgb(31 79 163 / 0); } 100% { box-shadow: 0 0 0 0 rgb(31 79 163 / 0); } }
    @media (prefers-reduced-motion: reduce) { .live { animation: none; } }
    .act-code { color: var(--color-text-muted); font-size: 0.82rem; font-weight: 600; }
    .act-title { font-size: 1.32rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
    .act-title a { color: inherit; text-decoration: none; }
    .act-site { margin-top: 0.15rem; color: var(--color-text-muted); font-size: 0.9rem; }
    .due.is-late { color: var(--color-bad); font-weight: 600; }
    .act-qty { display: flex; align-items: center; gap: 0.75rem; }
    .act-qty b { flex: 0 0 auto; font-weight: 700; }
    .bar { display: block; flex: 1 1 auto; height: 0.62rem; overflow: hidden; border-radius: 9999px; background: var(--color-track); }
    .bar > span { display: block; height: 100%; border-radius: inherit; background: var(--color-gold); transition: width 400ms var(--ease-out-expo); }
    .tools4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.4rem; }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      min-height: 4.2rem;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 0.7rem;
      color: var(--color-text);
      font-size: 0.78rem;
      font-weight: 600;
      text-decoration: none;
    }
    .tile.span2 { grid-column: span 2; aspect-ratio: auto; flex-direction: row; gap: 0.45rem; font-size: 0.9rem; }
    .thumb { background: var(--color-field); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .add { border: 1.5px dashed var(--color-line-strong); background: #fbfaf8; color: var(--color-text-muted); }
    .note { background: var(--color-field); }
    .plus {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      min-height: 3.6rem;
      border-radius: 1rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-size: 1.2rem;
      font-weight: 800;
      transition: transform 120ms var(--ease-out-expo), filter 160ms var(--ease-out-expo);
    }
    .plus:active:not(:disabled) { transform: scale(0.985); filter: brightness(0.95); }
    /* +1 rises out of the button: the tap was counted. */
    .plus-wrap { position: relative; display: grid; }
    .fx { position: absolute; left: 50%; top: 0; z-index: 1; padding: 0.15rem 0.6rem; border-radius: 9999px; background: var(--color-charcoal); color: var(--color-gold); font-size: 0.9rem; font-weight: 800; white-space: nowrap; pointer-events: none; transform: translate(-50%, 0); opacity: 0; animation: rise 900ms linear; }
    /* linear steps that slow down toward the top, so the label stays readable before it fades */
    @keyframes rise { 0% { transform: translate(-50%, 0.4rem) scale(0.9); opacity: 0; } 14% { transform: translate(-50%, -0.7rem) scale(1); opacity: 1; } 40% { transform: translate(-50%, -1.45rem); opacity: 1; } 70% { transform: translate(-50%, -1.8rem); opacity: 0.85; } 100% { transform: translate(-50%, -1.95rem); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .hn-s::after { transition-duration: 1ms; }
      @keyframes rise { 0% { transform: translate(-50%, -1rem); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(-50%, -1rem); opacity: 0; } }
    }
    .plus:disabled { opacity: 0.5; }

    /* Next orders: one row each, the play circle starts it straight away. */
    .list-title { display: flex; align-items: center; gap: 0.5rem; margin-top: 1.25rem; font-size: 1.02rem; font-weight: 700; }
    .note-line { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem; color: var(--color-bad-ink); font-size: 0.9rem; }
    .tools { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
    .search { display: flex; flex: 1 1 12rem; align-items: center; gap: 0.5rem; min-height: 2.9rem; padding: 0 0.8rem; border: 1px solid var(--color-line-strong); border-radius: 0.75rem; background: var(--color-panel); color: var(--color-text-muted); }
    .search:focus-within { border-color: var(--color-gold); box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25); }
    .search input { width: 100%; min-width: 0; border: 0; background: transparent; color: var(--color-text); font-size: 1rem; outline: none; }
    .sorter .flt-btn { min-height: 2.6rem; }
    .nexts { display: grid; gap: 0.5rem; margin-top: 0.6rem; }
    .nx { display: flex; align-items: center; gap: 0.5rem; padding-right: 0.7rem; border-radius: 1rem; background: var(--color-panel); box-shadow: 0 1px 2px rgb(20 20 20 / 0.05); }
    .nx.is-bad { background: var(--color-bad-tint); }
    .nx-main { display: grid; flex: 1 1 auto; gap: 0.15rem; min-width: 0; min-height: 4rem; padding: 0.7rem 0 0.7rem 0.9rem; color: var(--color-text); text-decoration: none; }
    .nx-title { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .is-bad .nx-title { color: var(--color-bad-ink); }
    .nx-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0 0.55rem; color: var(--color-text-muted); font-size: 0.82rem; }
    .is-bad .nx-meta { color: var(--color-bad-ink); }
    .nx-code { font-weight: 600; }
    .nx-flag { color: var(--color-bad); font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
    .mini { display: block; width: 100%; max-width: 10rem; height: 0.3rem; margin-top: 0.25rem; overflow: hidden; border-radius: 9999px; background: var(--color-track); }
    .mini > span { display: block; height: 100%; background: var(--color-gold); }
    .nx-go { display: grid; flex: 0 0 auto; place-items: center; width: 2.9rem; height: 2.9rem; border-radius: 9999px; background: var(--color-gold-fill); color: var(--color-gold-ink); }
    .nx-go aon-icon { margin-left: 0.12rem; }
    .nx-go.is-off { background: var(--color-field); color: var(--color-text-muted); }
    .nx-go.is-bad { background: var(--color-panel); color: var(--color-bad); }
    .nx-go.is-bad aon-icon { margin-left: 0; }
    .nx-go:disabled { opacity: 0.5; }
    .more { margin-top: 0.5rem; }
    .more button { display: flex; width: 100%; align-items: center; justify-content: center; gap: 0.4rem; min-height: 2.9rem; border: 1px solid var(--color-line-strong); border-radius: 0.85rem; background: var(--color-panel); font-weight: 600; }
    .none { padding: 0.9rem; border-radius: 1rem; background: var(--color-field); color: var(--color-text-muted); text-align: center; }
    .fold { margin-top: 1rem; }
    .fold summary { display: flex; align-items: center; gap: 0.45rem; min-height: 2.9rem; padding: 0 0.875rem; border-radius: 1rem; background: var(--color-panel); font-weight: 600; cursor: pointer; list-style: none; box-shadow: 0 1px 2px rgb(20 20 20 / 0.05); }
    .fold summary::-webkit-details-marker { display: none; }
    .fold .chev { margin-left: auto; color: var(--color-text-muted); transition: transform 180ms var(--ease-out-expo); }
    .fold[open] .chev { transform: rotate(90deg); }
    .list { margin-top: 0.5rem; overflow: hidden; border-radius: 1rem; background: var(--color-panel); }
    .list li + li { border-top: 1px solid var(--color-line); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; min-height: 3.6rem; padding: 0.55rem 0.6rem 0.55rem 0.875rem; color: var(--color-text); text-decoration: none; }
    .row:active { background: var(--color-row-tint); }
    .row-main { display: grid; gap: 0.15rem; min-width: 0; }
    .row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-meta { display: flex; min-width: 0; color: var(--color-text-muted); font-size: 0.84rem; }
    .row-end { display: flex; flex: 0 0 auto; align-items: center; gap: 0.3rem; }
    .pill { display: inline-flex; align-items: center; height: 1.35rem; padding: 0 0.5rem; border-radius: 9999px; background: var(--color-ok-tint); color: var(--color-ok-ink); font-size: 0.75rem; font-weight: 600; white-space: nowrap; }

    /* the shift field kit for the stale-shift card */
    .stale-title { display: flex; align-items: center; gap: 0.5rem; color: var(--color-bad-ink); font-size: 1.1rem; font-weight: 600; }
    .field-label { font-size: 0.9rem; color: var(--color-text-muted); }
    .field { display: block; width: 100%; min-height: 2.85rem; margin-top: 0.25rem; padding: 0 0.75rem; border: 1px solid var(--color-line-strong); border-radius: 0.5rem; background: #fff; font-size: 1rem; outline: none; }
    .field:focus-visible { border-color: var(--color-gold); box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25); }
    .field-area { padding-top: 0.55rem; padding-bottom: 0.55rem; }

    /* Wrappers only matter on a wide screen; on a phone the page is one column. */
    .col-lead,
    .col-list {
      display: contents;
    }
    @media (min-width: 900px), (orientation: landscape) and (min-width: 640px) and (max-height: 520px) {
      .page {
        display: grid;
        grid-template-columns: minmax(0, 25rem) minmax(0, 1fr);
        gap: 0 1.75rem;
        align-items: start;
        padding: 1.25rem 1.5rem 0.5rem;
      }
      .col-lead {
        position: sticky;
        top: 4.6rem;
        display: block;
      }
      .col-list {
        display: block;
      }
      .hero {
        margin: 0;
        border-radius: 1.4rem;
      }
      .list-title {
        margin-top: 0.2rem;
      }
      .nexts {
        grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      }
    }
    /* A phone on its side: keep the clock and the order, drop the drawing and the notes. */
    @media (orientation: landscape) and (max-height: 500px) {
      .page {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        padding-top: 0.9rem;
      }
      .col-lead {
        top: 4rem;
      }
      .hero-img,
      .h-note {
        display: none;
      }
      .h-timer {
        font-size: 2.3rem;
      }
    }
  `,
})
export class OrdersComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(WorkerStore);
  private readonly clock = inject(ClockService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);
  private readonly urls = new BlobUrls();

  protected readonly busy = signal(false);
  protected readonly staleEnd = signal('');
  protected readonly staleReason = signal('');

  protected readonly shiftTotal = computed(() => formatDuration(this.store.shiftMinutes()));

  /** The shift clock: live h:mm:ss while the shift runs, today's total otherwise. */
  protected readonly shiftClock = computed(() => {
    const open = this.store.openShift();
    const ms = open ? Math.max(0, this.clock.now() - open.startedAt) : this.store.shiftMinutes() * 60_000;
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return { text: open ? `${h}:${pad(m)}:${pad(sec)}` : `${h}:${pad(m)}`, aria: `${h} h ${m} min` };
  });

  /** The shift has ended today and the day's report is not yet with the manager. */
  protected readonly reportDue = computed(() => {
    if (!this.store.lastEndedShift()) return false;
    const s = this.store.summary();
    return !s || s.status === 'DRAFT' || s.status === 'RETURNED';
  });

  protected readonly staleMin = computed(() => {
    const s = this.store.staleShift();
    return s ? toLocalInput(s.startedAt + 60_000) : '';
  });
  protected readonly staleMax = computed(() => toLocalInput(this.clock.now()));
  /** Suggest a normal working day after the start, never later than now. */
  protected readonly staleDefault = computed(() => {
    const s = this.store.staleShift();
    return s ? toLocalInput(Math.min(s.startedAt + 8 * 3_600_000, this.clock.now())) : '';
  });

  protected readonly activeClock = computed(() => {
    const order = this.store.activeOrder();
    const ms = order ? orderElapsedMs(this.store.dayEntries(), order.id, this.clock.now()) : 0;
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return { hm: `${pad(h)}:${pad(m)}`, s: pad(s), aria: `${h} h ${m} min` };
  });

  /** "Dobro jutro, Janez" by the hour, with the first name only. */
  protected readonly greeting = computed(() => {
    const hour = new Date(this.clock.now()).getHours();
    const name = (this.session.user()?.displayName ?? '').trim().split(/\s+/)[0] ?? '';
    const key: TranslationKey = hour < 10 ? 'home.helloMorning' : hour < 18 ? 'home.helloDay' : 'home.helloEvening';
    return this.i18n.t(key, { name });
  });

  /** The two newest photos of the running order that still have a preview on this device. */
  protected readonly activePhotos = computed(() => {
    const id = this.store.activeOrder()?.id;
    const list = id ? this.store.photos().filter((p) => p.workOrderId === id && (p.thumb || p.blob)).slice(0, 2) : [];
    this.urls.prune(new Set(list.map((p) => p.id)));
    return list.map((p) => ({ id: p.id, url: this.urls.url(p.id, p.thumb ?? p.blob) }));
  });

  // ---- home layout
  protected readonly today = computed(() => this.clock.now());
  protected readonly runningId = computed(() => this.store.activeSegment()?.workOrderId ?? null);
  /** Orders by what they need: the running one, the ones to do, problems, and the finished ones. */
  protected readonly groups = computed(() => {
    const run = this.runningId();
    const all = this.store.orders();
    return {
      running: all.filter((o) => o.id === run),
      todo: all.filter((o) => o.id !== run && (o.status === 'NEW' || o.status === 'IN_PROGRESS')),
      issue: all.filter((o) => o.id !== run && o.status === 'ISSUE'),
      done: all.filter((o) => o.id !== run && o.status === 'COMPLETED'),
    };
  });
  /** The one thing to do now, in plain words. */
  protected readonly nextStep = computed((): { key: TranslationKey; params?: Record<string, string> } => {
    if (this.store.openShift()) {
      const active = this.store.activeOrder();
      return active ? { key: 'home.nextWork', params: { code: active.code ?? '' } } : { key: 'home.nextPick' };
    }
    if (this.reportDue()) return { key: 'home.nextReport' };
    return this.store.lastEndedShift() ? { key: 'home.nextDone' } : { key: 'home.nextStart' };
  });
  /** 0 start work, 1 work on orders, 2 hand in the report, 3 the day is done. */
  protected readonly dayStep = computed(() => (this.store.openShift() ? 1 : this.reportDue() ? 2 : this.store.lastEndedShift() ? 3 : 0));
  /** Open orders other than the running one, problems first. */
  protected readonly listOrders = computed(() => {
    const g = this.groups();
    return [...g.issue, ...g.todo];
  });
  /** Search, sort and how many open orders show before "show all". */
  protected readonly orderQuery = signal('');
  protected readonly orderSort = signal<'due' | 'code'>('due');
  protected readonly showAll = signal(false);
  protected readonly matchingOrders = computed(() => {
    const q = this.orderQuery().trim().toLocaleLowerCase();
    const list = this.listOrders().filter((o) => !q || `${o.code ?? ''} ${o.title} ${o.siteName}`.toLocaleLowerCase().includes(q));
    return this.orderSort() === 'code'
      ? [...list].sort((a, b) => compareCodes(a.code, b.code))
      : [...list].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  });
  protected readonly shownOrders = computed(() => (this.showAll() ? this.matchingOrders() : this.matchingOrders().slice(0, 6)));

  protected ratio(o: { doneQty: number; plannedQty: number }): number {
    return progressRatio(o.doneQty, o.plannedQty);
  }
  /** Deadline text for open orders; late in red. */
  protected dueLabel(o: { dueDate: string | null; status: WorkOrderStatus }): { text: string; late: boolean } | null {
    if (!o.dueDate || o.status === 'COMPLETED') return null;
    const today = toIsoDate();
    if (o.dueDate < today) return { text: this.i18n.t('home.overdue', { date: this.i18n.dateShort(o.dueDate) }), late: true };
    if (o.dueDate === today) return { text: this.i18n.t('home.dueToday'), late: false };
    return { text: this.i18n.t('orders.due', { date: this.i18n.dateShort(o.dueDate) }), late: false };
  }

  private readonly releaseUrls = inject(DestroyRef).onDestroy(() => this.urls.clear());

  protected statusKey(status: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${status}`;
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected async startShift(): Promise<void> {
    await this.run(async () => {
      const siteId = await this.store.chooseSite();
      if (siteId === undefined) return;
      const entry = await this.store.startShift(siteId);
      this.toast.success(startedMessage(this.i18n, entry.startedAt, this.store.shiftSiteName()));
    });
  }

  protected async endShift(): Promise<void> {
    await this.run(async () => {
      const minutes = await this.store.endShift();
      this.toast.success(this.i18n.t('shift.endedToast', { time: this.i18n.time(Date.now()), duration: formatDuration(minutes) }));
    });
  }

  /** The play circle on a row: starts that order now, or says how to start the day first. */
  protected async startOrder(orderId: string): Promise<void> {
    if (this.store.dayClosed()) {
      this.toast.show(this.i18n.t('day.closedBlock'));
      return;
    }
    if (!this.store.openShift()) {
      this.toast.show(this.i18n.t('home.startFirst'));
      return;
    }
    await this.run(() => this.startWithMorph(orderId));
  }

  /** One key per counted tap: a new key replays the rise. */
  protected readonly plusFx = signal<readonly number[]>([]);
  private fxKey = 0;

  protected async addOne(orderId: string): Promise<void> {
    await this.run(async () => {
      await this.store.addQuantity(orderId, 1);
      const key = ++this.fxKey;
      this.plusFx.set([key]);
      setTimeout(() => {
        if (this.plusFx()[0] === key) this.plusFx.set([]);
      }, 950);
    });
  }

  /** The row being started and the card it becomes share one name, so the row grows into the card. */
  protected readonly morphId = signal<string | null>(null);

  private async startWithMorph(orderId: string): Promise<void> {
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => { updateCallbackDone: Promise<void>; finished: Promise<void> } };
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || still) {
      await this.store.startOrder(orderId);
      return;
    }
    this.morphId.set(orderId);
    // Let the name reach the row before the old state is captured.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const vt = doc.startViewTransition(async () => {
      await this.store.startOrder(orderId);
      await this.cardShown(orderId);
    });
    void vt.finished.finally(() => this.morphId.set(null));
    await vt.updateCallbackDone;
  }

  /** Waits, at most half a second, until the running order's card is in the DOM. Timers, not frames: a view transition holds frames back. */
  private async cardShown(orderId: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      if (document.querySelector(`.act[data-order="${orderId}"]`)) return;
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  protected async pause(): Promise<void> {
    await this.run(() => this.store.pauseOrder());
  }

  protected async declareEnd(): Promise<void> {
    const raw = this.staleEnd() || this.staleDefault();
    const at = new Date(raw).getTime();
    if (!this.staleReason().trim()) {
      this.toast.error(this.i18n.t('stale.reasonRequired'));
      return;
    }
    await this.run(async () => {
      await this.store.declareShiftEnd(at, this.staleReason());
      this.staleEnd.set('');
      this.staleReason.set('');
      this.toast.success(this.i18n.t('stale.done', { time: this.i18n.time(at) }));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
    } catch (err: unknown) {
      this.toast.error(workflowMessage(this.i18n, err));
    } finally {
      this.busy.set(false);
    }
  }
}
