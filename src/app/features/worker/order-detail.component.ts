import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { QuantityUnit, WorkOrderStatus } from '../../core/models/domain.models';
import { ClockService } from '../../core/ui/clock.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatClock } from '../../core/util/util';
import { hoursLabel } from '../../shared/ui/format';
import { IconComponent } from '../../shared/ui/icon.component';
import { progressRatio } from '../../shared/ui/tag-style';
import { WorkerStore } from './data/worker-store.service';
import { orderElapsedMs, workflowMessage } from './data/workflow-messages';
import { OrderPhotosComponent } from './photo/order-photos.component';

const QUICK_STEPS: Readonly<Record<QuantityUnit, readonly number[]>> = {
  PCS: [1, 2, 5],
  M: [1, 5, 10],
  M2: [1, 5, 10],
  M3: [0.5, 1, 2],
  H: [0.5, 1, 2],
  KG: [10, 50, 100],
  T: [0.5, 1, 5],
  KPL: [1, 2, 5],
};

type NoteMode = 'NOTE' | 'ISSUE';

@Component({
  selector: 'aon-order-detail',
  imports: [FormsModule, RouterLink, IconComponent, OrderPhotosComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-page">
      <a routerLink="/w/orders" class="w-back"><aon-icon name="arrow-left" [size]="18" [stroke]="2" />{{ i18n.t('order.backToList') }}</a>

      @if (order(); as o) {
        <div class="w-stack">
          <!-- The order: what, where, by when, with whom, and the time spent on it today -->
          <section class="w-card" aria-labelledby="order-code">
            <p class="no-label">{{ i18n.t('order.numberLabel', { code: o.code ?? '–' }) }}</p>
            <h1 id="order-code" class="title">{{ o.title }}</h1>
            <div class="sub">
              <span class="w-small">{{ o.location }} · {{ o.siteName }}</span>
              <span class="w-pill" [attr.data-s]="running() ? 'IN_PROGRESS' : o.status">{{ running() ? i18n.t('orders.running') : i18n.t(statusKey(o.status)) }}</span>
            </div>
            @if (o.dueDate || crewmates().length) {
              <p class="w-small w-muted mt-1">
                @if (o.dueDate) {
                  {{ i18n.t('orders.due', { date: i18n.date(o.dueDate) }) }}
                }
                @if (o.dueDate && crewmates().length) {
                  ·
                }
                @if (crewmates().length) {
                  {{ i18n.t('order.withCrew', { names: crewmates().join(', ') }) }}
                }
              </p>
            }
            <div class="w-rule"></div>
            <div class="time">
              <span>
                <span class="w-small block">{{ i18n.t('order.timeOnOrder') }}</span>
                <span class="sync" [class.is-pending]="o.dirty === 1">
                  <aon-icon [name]="o.dirty === 1 ? 'refresh' : 'circle-check'" [size]="13" [stroke]="2.25" />{{ o.dirty === 1 ? i18n.t('order.pending') : i18n.t('orders.synced') }}
                </span>
              </span>
              <span class="clock" role="timer">{{ elapsed() }}</span>
            </div>
          </section>

          <!-- What can be done with it now -->
          <div class="acts">
            @if (o.status === 'COMPLETED') {
              <p class="w-alert is-ok"><aon-icon name="circle-check" [size]="18" />{{ i18n.t('order.completedNote') }}</p>
              @if (running()) {
                <button type="button" class="pause" [disabled]="busy()" (click)="pause()"><aon-icon name="stop" [size]="18" [stroke]="2.25" />{{ i18n.t('order.stopMyTime') }}</button>
              }
            } @else if (store.dayClosed()) {
              <p class="w-alert"><aon-icon name="lock" [size]="18" />{{ i18n.t('day.closedBlock') }}</p>
            } @else if (store.staleShift()) {
              <p class="w-alert"><aon-icon name="clock" [size]="18" />{{ i18n.t('stale.blocked') }}</p>
            } @else {
              @if (o.status === 'ISSUE') {
                <p class="w-alert"><aon-icon name="alert" [size]="18" />{{ i18n.t('order.issueNote') }}</p>
              }
              @if (running()) {
                <button type="button" class="pause" [disabled]="busy()" (click)="pause()"><aon-icon name="pause" [size]="18" [stroke]="2.25" />{{ i18n.t('order.pauseOrder') }}</button>
              } @else {
                <div class="slide" #trkGo>
                  <span class="slide-fill" [style.width.%]="slidePos('go') * 100" aria-hidden="true"></span>
                  <span class="slide-text" aria-hidden="true"><span class="slide-l">{{ primaryLabel() }}</span><span class="slide-h">{{ i18n.t('home.slideHint') }}</span></span>
                  <button type="button" class="knob" [class.is-drag]="dragKey() === 'go'" [style.transform]="'translateX(' + slidePos('go') * (trkGo.clientWidth - 64) + 'px)'" [attr.aria-label]="primaryLabel()" (pointerdown)="slideDown($event, trkGo, 'go')" (pointermove)="slideMove($event)" (pointerup)="slideUp()" (pointercancel)="slideCancel()" (keydown.enter)="primary()"><aon-icon name="play" [size]="22" [stroke]="2.5" /></button>
                </div>
              }
              @if (canFinishNow()) {
                <div class="slide is-dark" #trkEnd>
                  <span class="slide-fill" [style.width.%]="slidePos('end') * 100" aria-hidden="true"></span>
                  <span class="slide-text" aria-hidden="true"><span class="slide-l">{{ i18n.t('order.finishOrder') }}</span><span class="slide-h">{{ finishSummary() }}</span></span>
                  <button type="button" class="knob" [class.is-drag]="dragKey() === 'end'" [style.transform]="'translateX(' + slidePos('end') * (trkEnd.clientWidth - 64) + 'px)'" [attr.aria-label]="i18n.t('order.finishOrder')" (pointerdown)="slideDown($event, trkEnd, 'end')" (pointermove)="slideMove($event)" (pointerup)="slideUp()" (pointercancel)="slideCancel()" (keydown.enter)="finish()"><aon-icon name="stop" [size]="22" [stroke]="2.5" /></button>
                </div>
                @if (crewmates().length) {
                  <p class="note">{{ i18n.t('order.finishCrewHint') }}</p>
                }
              }
            }
          </div>

          <!-- Quantity -->
          <section class="w-card" aria-labelledby="qty-title">
            <h2 id="qty-title" class="w-h2">
              {{ i18n.t('order.quantityTitle') }}
              <span class="qty">{{ i18n.t('order.progress', { done: i18n.number(o.doneQty), planned: i18n.number(o.plannedQty), unit: unitLabel() }) }}</span>
            </h2>
            <div class="w-bar mt-2.5" aria-hidden="true"><span [style.width.%]="progressRatio(o.doneQty, o.plannedQty) * 100"></span></div>

            @if (o.status !== 'COMPLETED' && !store.dayClosed()) {
              <div class="w-trio mt-3" role="group" [attr.aria-label]="i18n.t('order.quantityAria')">
                @for (step of steps(); track step) {
                  <button
                    type="button"
                    class="w-btn w-btn-soft"
                    [disabled]="busy()"
                    [attr.aria-label]="i18n.t('order.quantityAdd', { q: i18n.number(step), unit: unitLabel() })"
                    (click)="addQuantity(step)"
                  >
                    +{{ i18n.number(step) }} {{ unitLabel() }}
                  </button>
                }
              </div>
              <form class="custom mt-2" novalidate (ngSubmit)="addCustom()">
                <label class="block">
                  <span class="sr-only">{{ i18n.t('order.quantityCustom') }}</span>
                  <input
                    name="qty"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="any"
                    [placeholder]="i18n.t('order.quantityCustom')"
                    class="w-field is-flush"
                    [ngModel]="custom()"
                    (ngModelChange)="custom.set($event)"
                  />
                </label>
                <button type="submit" class="w-btn w-btn-dark" [disabled]="busy()">
                  <aon-icon name="plus" [size]="18" [stroke]="2.25" />{{ i18n.t('common.save') }}
                </button>
              </form>
            }
            @if (o.doneQty > 0 && !store.dayClosed()) {
              @if (!correcting()) {
                <button type="button" class="fix-link" (click)="correcting.set(true)"><aon-icon name="undo" [size]="15" />{{ i18n.t('order.fixQty') }}</button>
              } @else {
                <form class="fix mt-3" novalidate (ngSubmit)="saveCorrection()" [attr.aria-label]="i18n.t('order.fixQty')">
                  <p class="w-small">{{ i18n.t('order.fixHint', { done: i18n.number(o.doneQty), unit: unitLabel() }) }}</p>
                  <label class="block">
                    <span class="w-label">{{ i18n.t('order.fixAmount', { unit: unitLabel() }) }}</span>
                    <input name="fixQty" type="number" inputmode="decimal" min="0" [max]="o.doneQty" step="any" class="w-field" [ngModel]="fixQty()" (ngModelChange)="fixQty.set($event)" />
                  </label>
                  <label class="block">
                    <span class="w-label">{{ i18n.t('order.fixReason') }}</span>
                    <input name="fixReason" type="text" maxlength="500" class="w-field" [placeholder]="i18n.t('order.fixReasonPlaceholder')" [ngModel]="fixReason()" (ngModelChange)="fixReason.set($event)" />
                  </label>
                  <div class="fix-row">
                    <button type="button" class="w-btn w-btn-line" (click)="cancelCorrection()">{{ i18n.t('common.cancel') }}</button>
                    <button type="submit" class="w-btn w-btn-dark" [disabled]="busy()"><aon-icon name="undo" [size]="17" />{{ i18n.t('order.fixSave') }}</button>
                  </div>
                </form>
              }
            }
          </section>

          <aon-order-photos id="photos" class="anchor" [order]="o" [orderLabel]="o.code ?? ''" />

          <!-- Notes and problems -->
          <section id="note" class="w-card anchor" aria-labelledby="notes-title">
            <h2 id="notes-title" class="w-h2">{{ i18n.t('order.notesTitle') }}</h2>
            @if (o.status !== 'COMPLETED') {
              <div class="w-seg mt-3" role="group" [attr.aria-label]="i18n.t('order.notesTitle')">
                <button type="button" [attr.aria-pressed]="mode() === 'NOTE'" (click)="mode.set('NOTE')">
                  <aon-icon name="note" [size]="16" />{{ i18n.t('order.noteMode') }}
                </button>
                <button type="button" class="is-bad" [attr.aria-pressed]="mode() === 'ISSUE'" (click)="mode.set('ISSUE')">
                  <aon-icon name="alert" [size]="16" />{{ i18n.t('order.issueMode') }}
                </button>
              </div>
              <label class="mt-2 block">
                <span class="sr-only">{{ mode() === 'ISSUE' ? i18n.t('order.issueMode') : i18n.t('order.noteMode') }}</span>
                <textarea
                  rows="3"
                  maxlength="2000"
                  class="w-field"
                  [class.is-bad]="mode() === 'ISSUE'"
                  [placeholder]="mode() === 'ISSUE' ? i18n.t('order.issuePlaceholder') : i18n.t('order.notePlaceholder')"
                  [value]="noteText()"
                  (input)="noteText.set($any($event.target).value)"
                ></textarea>
              </label>
              <div class="note-actions mt-2">
                <button type="button" class="w-btn" [class]="mode() === 'ISSUE' ? 'w-btn-bad' : 'w-btn-dark'" [disabled]="busy()" (click)="saveNote()">
                  @if (mode() === 'ISSUE') {
                    <aon-icon name="alert" [size]="18" />{{ i18n.t('order.reportIssue') }}
                  } @else {
                    <aon-icon name="check" [size]="18" />{{ i18n.t('order.saveNote') }}
                  }
                </button>
              </div>
              @if (mode() === 'ISSUE') {
                <p class="w-small w-muted mt-1.5">{{ i18n.t('order.issueHint') }}</p>
              }
            }

            @if (myLogs().length) {
              <ol class="w-rows log mt-3">
                @for (l of myLogs(); track l.id) {
                  <li class="log-row" [class.is-pending]="!l.synced">
                    <span class="w-small w-muted log-time">{{ i18n.time(l.createdAt) }}</span>
                    <span class="min-w-0">
                      @switch (l.kind) {
                        @case ('QUANTITY') {
                          @if ((l.quantity ?? 0) < 0) {
                            <span class="block font-semibold">{{ i18n.t('order.logCorrection', { q: i18n.number(-(l.quantity ?? 0)), unit: unitLabel() }) }}</span>
                          } @else {
                            <span class="block font-semibold">{{ i18n.t('order.logQuantity', { q: i18n.number(l.quantity ?? 0), unit: unitLabel() }) }}</span>
                          }
                        }
                        @case ('ISSUE') {
                          <span class="log-kind is-bad">{{ i18n.t('order.logIssue') }}</span>
                        }
                        @default {
                          <span class="log-kind">{{ i18n.t('order.logNote') }}</span>
                        }
                      }
                      @if (l.text) {
                        <span class="block leading-snug">{{ l.text }}</span>
                      }
                    </span>
                  </li>
                }
              </ol>
            } @else {
              <p class="w-small w-muted mt-3">{{ i18n.t('order.timelineEmpty') }}</p>
            }
          </section>

          <!-- The order as written by the manager -->
          <section class="w-card" aria-labelledby="desc-title">
            <h2 id="desc-title" class="w-h2">{{ i18n.t('order.description') }}</h2>
            <p class="mt-1.5 max-w-[65ch] leading-relaxed">{{ o.description }}</p>
            <div class="w-rule"></div>
            <dl class="w-stats">
              <div>
                <dt>{{ i18n.t('order.estimate') }}</dt>
                <dd>{{ o.estimatedMinutes ? estimate(o.estimatedMinutes) : i18n.t('common.none') }}</dd>
              </div>
              <div>
                <dt>{{ i18n.t('order.plannedDate') }}</dt>
                <dd class="date">{{ o.date ? i18n.dateShort(o.date) : i18n.t('common.none') }}</dd>
              </div>
            </dl>
            <div class="w-rows mt-3">
              <p class="w-row"><span class="w-muted">{{ i18n.t('order.manager') }}</span><span class="font-semibold">{{ o.managerName }}</span></p>
            </div>
            @if (o.materials.length) {
              <h3 class="w-small w-muted mt-3">{{ i18n.t('order.materials') }}</h3>
              <ul class="w-rows mt-1">
                @for (m of o.materials; track $index) {
                  <li class="w-row">
                    <span>{{ m.name }}</span>
                    <span class="font-semibold tabular-nums">{{ m.qty !== null ? i18n.number(m.qty) + ' ' + (m.unit ?? '') : i18n.t('common.none') }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      } @else {
        <div class="w-card">
          <p class="font-semibold">{{ i18n.t('order.notFound') }}</p>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .no-label {
      color: var(--color-text-muted);
      font-size: 0.78rem;
      font-weight: 650;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-variant-numeric: tabular-nums;
    }
    .title {
      margin-top: 0.15rem;
      font-size: 1.15rem;
      font-weight: 650;
      line-height: 1.3;
    }
    .code {
      letter-spacing: -0.01em;
    }
    .sub {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: 0.4rem;
    }
    .time {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .clock {
      font-size: 1.45rem;
      font-weight: 500;
      letter-spacing: -0.01em;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .sync {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 0.15rem;
      color: var(--color-ok-ink);
      font-size: 0.8rem;
    }
    .sync.is-pending {
      color: var(--color-gold-ink);
    }
    .qty {
      font-size: 0.95rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .fix-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-height: 2.75rem;
      margin-top: 0.25rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .fix {
      display: grid;
      gap: 0.6rem;
      padding: 0.8rem;
      border-radius: 0.7rem;
      background: var(--color-row-tint);
      box-shadow: inset 0 0 0 1px var(--color-line-strong);
    }
    .fix-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
      gap: 0.5rem;
    }
    .custom {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.5rem;
    }
    .custom .w-btn {
      width: auto;
      padding: 0 1rem;
    }
    .note-actions {
      display: grid;
      gap: 0.5rem;
    }
    .log-row {
      display: grid;
      grid-template-columns: 3.25rem minmax(0, 1fr);
      gap: 0.5rem;
      padding: 0.55rem 0;
    }
    .log-row.is-pending {
      border-top-style: dashed;
    }
    .log-time {
      padding-top: 0.1rem;
      font-variant-numeric: tabular-nums;
    }
    .log-kind {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.8rem;
    }
    .log-kind.is-bad {
      color: var(--color-bad);
      font-weight: 600;
    }
    .w-stats dd.date {
      white-space: nowrap;
      font-size: 1rem;
      line-height: 1.35;
      padding-top: 0.2rem;
    }
    /* Arriving from the home screen's shortcut lands the section clear of the sticky bar. */
    .anchor {
      scroll-margin-top: 4.25rem;
    }
    /* Order actions: one slide control at a time, as on the home screen; finishing only once there is work to finish. */
    .acts {
      display: grid;
      gap: 0.6rem;
      margin-top: 0.95rem;
    }
    .slide {
      position: relative;
      display: flex;
      align-items: center;
      height: 64px;
      padding: 4px;
      overflow: hidden;
      border-radius: 9999px;
      background: var(--color-gold);
      color: var(--color-charcoal);
      touch-action: none;
      user-select: none;
    }
    .slide.is-dark {
      background: var(--color-rail);
      color: #fff;
    }
    .slide-fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: rgb(0 0 0 / 0.14);
    }
    .slide.is-dark .slide-fill {
      background: rgb(255 255 255 / 0.14);
    }
    .slide-text {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      text-align: center;
      pointer-events: none;
    }
    .slide-l {
      font-size: 1.08rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .slide-h {
      font-size: 0.8rem;
      font-weight: 500;
    }
    .knob {
      position: relative;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      background: var(--color-charcoal);
      color: var(--color-gold);
      box-shadow: 0 4px 12px -4px rgb(20 20 20 / 0.6);
      cursor: grab;
      touch-action: none;
      transition: transform 220ms var(--ease-out-expo);
    }
    .knob.is-drag {
      transition: none;
      cursor: grabbing;
    }
    .slide.is-dark .knob {
      background: #fff;
      color: var(--color-charcoal);
    }
    .pause {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-height: 3.25rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 9999px;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 650;
    }
    .note {
      color: var(--color-text-muted);
      font-size: 0.85rem;
      text-align: center;
    }
  `,
})
export class OrderDetailComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(WorkerStore);
  private readonly session = inject(SessionStore);
  private readonly clock = inject(ClockService);
  private readonly toast = inject(ToastService);

  /** Route param, bound by withComponentInputBinding. */
  readonly id = input.required<string>();

  protected readonly progressRatio = progressRatio;
  protected readonly busy = signal(false);
  protected readonly custom = signal<number | string | null>(null);
  protected readonly mode = signal<NoteMode>('NOTE');
  protected readonly noteText = signal('');

  protected readonly order = computed(() => this.store.orders().find((o) => o.id === this.id()) ?? null);
  protected readonly running = computed(() => this.store.activeSegment()?.workOrderId === this.id());
  protected readonly canFinish = computed(() => {
    const o = this.order();
    return !!o && this.store.canTransition(o.status, 'COMPLETED');
  });
  protected readonly crewmates = computed(() => {
    const me = this.session.user()?.id;
    return (this.order()?.crew ?? []).filter((c) => c.id !== me).map((c) => c.displayName);
  });
  protected readonly myLogs = computed(() =>
    this.store
      .todayLogs()
      .filter((l) => l.workOrderId === this.id())
      .slice()
      .reverse(),
  );
  protected readonly elapsed = computed(() => formatClock(orderElapsedMs(this.store.dayEntries(), this.id(), this.clock.now())));
  protected readonly steps = computed(() => QUICK_STEPS[this.order()?.unit ?? 'PCS']);
  protected readonly unitLabel = computed(() => this.i18n.t(`unit.${this.order()?.unit ?? 'PCS'}`));

  // ---- order actions
  /** Finishing is offered once there is something to finish: time on the order, a quantity, or a running timer. */
  protected readonly canFinishNow = computed(() => {
    const o = this.order();
    if (!o || !this.canFinish()) return false;
    return this.running() || o.doneQty > 0 || orderElapsedMs(this.store.dayEntries(), this.id(), this.clock.now()) > 0;
  });
  protected readonly primaryLabel = computed(() => {
    const o = this.order();
    if (!this.store.openShift()) return this.i18n.t('order.startShiftAndOrder');
    return o?.status === 'NEW' ? this.i18n.t('order.startOrder') : this.i18n.t('order.resumeOrder');
  });
  /** What finishing will record, so the worker checks it before confirming. */
  protected readonly finishSummary = computed(() => {
    const o = this.order();
    if (!o) return '';
    const photos = this.store.photos().filter((p) => p.workOrderId === o.id).length;
    return `${this.i18n.t('order.progress', { done: this.i18n.number(o.doneQty), planned: this.i18n.number(o.plannedQty), unit: this.unitLabel() })} · ${this.i18n.t('photo.count', { n: photos })}`;
  });
  protected primary(): Promise<void> {
    return this.store.openShift() ? this.start() : this.startShiftAndOrder();
  }
  /** Slide-to-confirm, as on the home screen: released past 92 % runs the action. */
  private readonly slides = signal<Record<string, number>>({});
  protected readonly dragKey = signal<string | null>(null);
  private drag: { key: string; startX: number; travel: number } | null = null;
  protected slidePos(key: string): number {
    return this.slides()[key] ?? 0;
  }
  private setSlide(key: string, v: number): void {
    this.slides.update((m) => ({ ...m, [key]: v }));
  }
  protected slideDown(e: PointerEvent, track: HTMLElement, key: string): void {
    if (this.busy() || e.button !== 0) return;
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    const travel = Math.max(1, track.clientWidth - 64);
    this.drag = { key, startX: e.clientX - this.slidePos(key) * travel, travel };
    this.dragKey.set(key);
  }
  protected slideMove(e: PointerEvent): void {
    if (!this.drag) return;
    this.setSlide(this.drag.key, Math.min(1, Math.max(0, (e.clientX - this.drag.startX) / this.drag.travel)));
  }
  protected slideUp(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dragKey.set(null);
    if (this.slidePos(d.key) < 0.92) {
      this.setSlide(d.key, 0);
      return;
    }
    this.setSlide(d.key, 1);
    navigator.vibrate?.(30);
    void (d.key === 'end' ? this.finish() : this.primary()).finally(() => this.setSlide(d.key, 0));
  }
  protected slideCancel(): void {
    if (this.drag) this.setSlide(this.drag.key, 0);
    this.drag = null;
    this.dragKey.set(null);
  }

  protected statusKey(status: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${status}`;
  }

  protected estimate(minutes: number): string {
    return hoursLabel(this.i18n, minutes);
  }

  protected start(): Promise<void> {
    return this.run(async () => {
      await this.store.startOrder(this.id());
      this.toast.success(this.i18n.t('order.startedToast', { code: this.order()?.code ?? '' }));
    });
  }

  protected startShiftAndOrder(): Promise<void> {
    return this.run(async () => {
      // The order's own object is the obvious choice; the worker is not asked again.
      await this.store.startShift(this.order()?.siteId ?? (await this.store.chooseSite()) ?? null);
      await this.store.startOrder(this.id());
      this.toast.success(this.i18n.t('order.startedToast', { code: this.order()?.code ?? '' }));
    });
  }

  protected pause(): Promise<void> {
    return this.run(() => this.store.pauseOrder());
  }

  protected finish(): Promise<void> {
    return this.run(async () => {
      const code = this.order()?.code ?? '';
      await this.store.finishOrder(this.id());
      this.toast.success(this.i18n.t('order.finishedToast', { code }));
    });
  }

  protected addQuantity(q: number): Promise<void> {
    return this.run(async () => {
      await this.store.addQuantity(this.id(), q);
      this.toast.success(this.i18n.t('order.quantityLogged', { q: this.i18n.number(q), unit: this.unitLabel() }));
    });
  }

  protected readonly correcting = signal(false);
  protected readonly fixQty = signal<number | string | null>(null);
  protected readonly fixReason = signal('');

  protected cancelCorrection(): void {
    this.correcting.set(false);
    this.fixQty.set(null);
    this.fixReason.set('');
  }

  protected saveCorrection(): Promise<void> {
    const o = this.order();
    const raw = this.fixQty();
    const q = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (!o || !Number.isFinite(q) || q <= 0 || q > o.doneQty) {
      this.toast.error(this.i18n.t('order.fixInvalid', { done: this.i18n.number(o?.doneQty ?? 0), unit: this.unitLabel() }));
      return Promise.resolve();
    }
    if (!this.fixReason().trim()) {
      this.toast.error(this.i18n.t('order.fixNeedReason'));
      return Promise.resolve();
    }
    return this.run(async () => {
      await this.store.correctQuantity(o.id, q, this.fixReason());
      this.toast.success(this.i18n.t('order.fixDone', { q: this.i18n.number(q), unit: this.unitLabel() }));
      this.cancelCorrection();
    });
  }

  protected addCustom(): Promise<void> {
    const raw = this.custom();
    const q = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      this.toast.error(this.i18n.t('order.quantityInvalid'));
      return Promise.resolve();
    }
    return this.addQuantity(q).then(() => this.custom.set(null));
  }

  protected saveNote(): Promise<void> {
    const text = this.noteText().trim();
    if (!text) {
      this.toast.error(this.i18n.t('order.textRequired'));
      return Promise.resolve();
    }
    const issue = this.mode() === 'ISSUE';
    return this.run(async () => {
      if (issue) await this.store.reportIssue(this.id(), text);
      else await this.store.addNote(this.id(), text);
      this.noteText.set('');
      this.mode.set('NOTE');
      this.toast.success(this.i18n.t(issue ? 'order.issueSaved' : 'order.noteSaved'));
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
