import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { QuantityUnit, WorkOrderStatus } from '../../core/models/domain.models';
import { ClockService } from '../../core/ui/clock.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDuration } from '../../core/util/util';
import { HoldButtonComponent } from '../../shared/ui/hold-button.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { TAG_FILL, progressRatio } from '../../shared/ui/tag-style';
import { WorkerStore } from './data/worker-store.service';
import { orderElapsedMs, workflowMessage } from './data/workflow-messages';

/** `YYYY-MM-DDTHH:MM` in local time, for datetime-local inputs. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Component({
  selector: 'aon-worker-orders',
  imports: [RouterLink, HoldButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-4 pb-6 pt-4">
      @if (store.staleShift(); as stale) {
        <!-- A shift left running from an earlier day: the real end is declared, never tapped now. -->
        <section class="border-2 border-hold bg-stock" aria-labelledby="stale-title">
          <div class="flex items-start gap-2 bg-hold px-4 py-3 text-white">
            <aon-icon name="clock" [size]="24" [stroke]="2.5" />
            <h2 id="stale-title" class="font-cond text-2xl leading-tight">{{ i18n.t('stale.title', { date: i18n.date(stale.startedAt) }) }}</h2>
          </div>
          <div class="grid gap-3 px-4 py-4">
            <p class="font-semibold leading-snug">{{ i18n.t('stale.body', { time: i18n.time(stale.startedAt) }) }}</p>
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('stale.endLabel') }}</span>
              <input
                type="datetime-local"
                class="mt-1 block min-h-14 w-full border-2 border-charcoal bg-white px-3 font-cond text-xl outline-none focus:ring-4 focus:ring-gold"
                [min]="staleMin()"
                [max]="staleMax()"
                [value]="staleEnd() || staleDefault()"
                (input)="staleEnd.set($any($event.target).value)"
              />
            </label>
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('stale.reasonLabel') }}</span>
              <textarea
                rows="2"
                maxlength="500"
                class="mt-1 block w-full border-2 border-charcoal bg-white px-3 py-2 text-lg outline-none placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
                [placeholder]="i18n.t('stale.reasonPlaceholder')"
                [value]="staleReason()"
                (input)="staleReason.set($any($event.target).value)"
              ></textarea>
            </label>
            <button
              type="button"
              class="flex min-h-16 items-center justify-center gap-2 bg-charcoal font-cond text-xl text-white disabled:opacity-50"
              [disabled]="busy()"
              (click)="declareEnd()"
            >
              <aon-icon name="check" [size]="22" [stroke]="3" />{{ i18n.t('stale.submit') }}
            </button>
            <p class="flex items-start gap-2 text-sm font-semibold text-ink-muted">
              <aon-icon name="shield" [size]="16" class="mt-0.5" />{{ i18n.t('stale.flagged') }}
            </p>
          </div>
        </section>
      } @else {
        <!-- Shift state -->
        <div class="flex items-end justify-between gap-3 border-b-2 border-charcoal pb-2">
          <p class="flex items-center gap-2 label-caps" [class.text-ink-muted]="!store.openShift()">
            @if (store.openShift(); as shift) {
              <span class="size-2.5 rounded-full bg-done" aria-hidden="true"></span>
              {{ i18n.t('shift.runningSince', { time: i18n.time(shift.startedAt) }) }}
            } @else if (store.lastEndedShift(); as ended) {
              {{ i18n.t('shift.endedAt', { time: i18n.time(ended.endedAt) }) }}
            } @else {
              {{ i18n.t('shift.notStarted') }}
            }
          </p>
          <p class="text-right">
            <span class="block label-caps text-ink-muted">{{ i18n.t('shift.todayTotal') }}</span>
            <span class="font-cond text-3xl leading-none">{{ shiftTotal() }}</span>
          </p>
        </div>
      }

      @if (store.summary(); as s) {
        @if (s.status === 'RETURNED') {
          <a routerLink="/w/day" class="mt-4 block border-2 border-hold bg-hold-pale px-4 py-3 text-hold-ink no-underline">
            <span class="flex items-center justify-between gap-2 font-cond text-xl">
              <span class="flex items-center gap-2"><aon-icon name="alert" [size]="22" />{{ i18n.t('day.returnedBanner') }}</span>
              <aon-icon name="chevron-right" [size]="24" [stroke]="2.75" />
            </span>
            @if (s.reviewerNote) {
              <span class="mt-1 block font-semibold leading-snug text-ink">»{{ s.reviewerNote }}«</span>
            }
          </a>
        }
      }

      <!-- Active order: the gold tag -->
      @if (store.activeOrder(); as order) {
        <section class="tag-shape mt-4 bg-gold py-5 pr-4 text-ink" aria-labelledby="active-code">
          <span class="tag-eyelet"></span>
          <div class="flex items-start justify-between gap-3">
            <h2 id="active-code" class="font-cond-tight text-code leading-none">{{ order.code }}</h2>
            <span class="flex items-center gap-1.5 bg-charcoal px-2.5 py-1.5 label-caps text-gold">
              <aon-icon name="play" [size]="14" [stroke]="3" />{{ i18n.t('orders.running') }}
            </span>
          </div>
          <p class="mt-1 text-xl font-bold leading-snug">{{ order.title }}</p>
          <p class="mt-0.5 flex items-center gap-1.5 text-[0.95rem] font-semibold text-gold-ink">
            <aon-icon name="pin" [size]="16" />{{ order.location }}
          </p>

          <p class="mt-4 label-caps text-gold-ink">{{ i18n.t('order.timeOnOrder') }}</p>
          <p class="flex items-baseline font-cond-tight leading-[0.85]" role="timer" [attr.aria-label]="activeClock().aria">
            <span class="text-[6.5rem]">{{ activeClock().hm }}</span>
            <span class="ml-1 text-[2.5rem] text-gold-ink">:{{ activeClock().s }}</span>
          </p>

          <div class="mt-4">
            <div class="flex items-baseline justify-between label-caps">
              <span>{{ i18n.t('order.quantityTitle') }}</span>
              <span class="font-cond text-xl normal-case tracking-normal">
                {{ i18n.t('order.progress', { done: i18n.number(order.doneQty), planned: i18n.number(order.plannedQty), unit: i18n.t(unitKey(order.unit)) }) }}
              </span>
            </div>
            <div class="mt-1 h-4 border-2 border-charcoal bg-gold-pale" aria-hidden="true">
              <div class="h-full bg-charcoal" [style.width.%]="progressRatio(order.doneQty, order.plannedQty) * 100"></div>
            </div>
          </div>

          <div class="mt-5 grid grid-cols-[1fr_auto] gap-2">
            <a
              [routerLink]="['/w/orders', order.id]"
              class="flex min-h-14 items-center justify-between bg-charcoal px-5 font-cond text-xl text-white no-underline"
              [attr.aria-label]="i18n.t('orders.open', { code: order.code ?? '' })"
            >
              {{ i18n.t('orders.openShort') }}
              <aon-icon name="chevron-right" [size]="24" [stroke]="2.75" />
            </a>
            <button
              type="button"
              class="flex min-h-14 items-center gap-2 px-5 font-cond text-xl ring-2 ring-inset ring-charcoal disabled:opacity-50"
              [disabled]="busy()"
              (click)="pause()"
            >
              <aon-icon name="pause" [size]="22" [stroke]="2.75" />{{ i18n.t('order.pauseOrder') }}
            </button>
          </div>
        </section>
      } @else if (!store.staleShift()) {
        <section class="mt-4 border-2 border-dashed border-charcoal px-5 py-6">
          <h2 class="font-cond text-2xl leading-tight">{{ i18n.t('orders.activeNone') }}</h2>
          <p class="mt-1 text-ink-muted">{{ store.openShift() ? i18n.t('orders.pickHint') : i18n.t('order.needShift') }}</p>
        </section>
      }

      <!-- My orders -->
      <div class="mt-8 flex items-baseline justify-between">
        <h2 class="font-cond text-2xl">{{ i18n.t('orders.title') }}</h2>
        <span class="label-caps text-ink-muted">{{ i18n.t('orders.count', { n: store.orders().length }) }}</span>
      </div>

      @if (store.refreshFailed()) {
        <p class="mt-3 flex items-start gap-2 border-2 border-charcoal bg-stock px-4 py-3 text-[0.95rem] font-semibold" role="status">
          <aon-icon name="cloud-off" [size]="20" class="text-hold" />{{ i18n.t('orders.loadFailed') }}
        </p>
      }

      @if (store.orders().length === 0) {
        <div class="mt-3 border-2 border-charcoal bg-stock px-5 py-6">
          <p class="font-cond text-xl">{{ i18n.t('orders.empty') }}</p>
          <p class="mt-1 text-ink-muted">{{ i18n.t('orders.emptyHint') }}</p>
        </div>
      } @else {
        <ul class="mt-3 grid gap-2.5">
          @for (order of store.orders(); track order.id) {
            @let fill = TAG_FILL[order.status];
            @let running = store.activeSegment()?.workOrderId === order.id;
            <li class="min-w-0">
              <a
                [routerLink]="['/w/orders', order.id]"
                class="tag-shape flex min-h-[5.75rem] items-stretch no-underline"
                [class]="fill.cls"
                [attr.aria-label]="i18n.t('orders.open', { code: order.code ?? '' }) + ' · ' + i18n.t(statusKey(order.status)) + (order.dirty ? ' · ' + i18n.t('order.pending') : '')"
              >
                <span class="tag-eyelet"></span>
                <span class="min-w-0 flex-1 py-3 pr-3">
                  <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="font-cond-tight text-[1.6rem] leading-none">{{ order.code }}</span>
                    <span class="flex items-center gap-1 label-caps" [class]="fill.muted">
                      <aon-icon [name]="running ? 'timer' : fill.icon" [size]="14" [stroke]="3" />
                      {{ running ? i18n.t('orders.running') : i18n.t(statusKey(order.status)) }}
                    </span>
                  </span>
                  <span class="mt-1 block truncate text-lg font-bold leading-snug">{{ order.title }}</span>
                  <span class="mt-0.5 flex flex-wrap gap-x-3 text-[0.9rem] font-semibold" [class]="fill.muted">
                    <span>{{ i18n.t('order.progress', { done: i18n.number(order.doneQty), planned: i18n.number(order.plannedQty), unit: i18n.t(unitKey(order.unit)) }) }}</span>
                    @if (order.dueDate && order.status !== 'COMPLETED') {
                      <span>{{ i18n.t('orders.due', { date: i18n.date(order.dueDate) }) }}</span>
                    }
                    @if (order.crew.length > 1) {
                      <span class="flex items-center gap-1"><aon-icon name="users" [size]="14" [stroke]="2.5" />{{ order.crew.length }}</span>
                    }
                  </span>
                </span>
                <!-- Tear-off stub: dashed perforation until the server has the change. -->
                <span
                  class="flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-l-2 border-current/60"
                  [class.border-dashed]="order.dirty === 1"
                >
                  <aon-icon name="chevron-right" [size]="26" [stroke]="2.75" />
                  @if (order.dirty === 1) {
                    <aon-icon name="refresh" [size]="14" [stroke]="2.5" [class]="fill.muted" />
                  }
                </span>
              </a>
            </li>
          }
        </ul>
      }
    </div>

    <!-- Shift slab in the thumb zone -->
    @if (!store.staleShift()) {
      <div class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t-2 border-charcoal bg-ground px-4 pb-3 pt-3">
        @if (store.openShift()) {
          <aon-hold-button
            tone="charcoal"
            [label]="i18n.t('shift.end')"
            [hint]="i18n.t('shift.holdHint')"
            [ariaLabel]="i18n.t('shift.holdAria', { label: i18n.t('shift.end') })"
            [disabled]="busy()"
            (confirmed)="endShift()"
          />
        } @else if (reportDue()) {
          <a
            routerLink="/w/day"
            class="flex min-h-[5.5rem] items-center justify-between gap-4 bg-gold px-6 font-cond text-[1.6rem] leading-none text-ink no-underline"
          >
            {{ i18n.t('day.close') }}<aon-icon name="file" [size]="30" [stroke]="2.5" />
          </a>
          <aon-hold-button
            class="mt-2"
            tone="charcoal"
            [height]="64"
            [label]="i18n.t('shift.startAgain')"
            [hint]="i18n.t('shift.holdHint')"
            [ariaLabel]="i18n.t('shift.holdAria', { label: i18n.t('shift.startAgain') })"
            [disabled]="busy()"
            (confirmed)="startShift()"
          />
        } @else {
          <aon-hold-button
            tone="gold"
            [label]="i18n.t('shift.start')"
            [hint]="i18n.t('shift.holdHint')"
            [ariaLabel]="i18n.t('shift.holdAria', { label: i18n.t('shift.start') })"
            [disabled]="busy()"
            (confirmed)="startShift()"
          />
        }
        <p class="mt-2 flex items-center gap-1.5 text-[0.8rem] font-semibold text-ink-muted">
          <aon-icon name="shield" [size]="14" />{{ i18n.t('shift.noGps') }}
        </p>
      </div>
    }
  `,
})
export class OrdersComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(WorkerStore);
  private readonly clock = inject(ClockService);
  private readonly toast = inject(ToastService);

  protected readonly TAG_FILL = TAG_FILL;
  protected readonly progressRatio = progressRatio;
  protected readonly busy = signal(false);
  protected readonly staleEnd = signal('');
  protected readonly staleReason = signal('');

  protected readonly shiftTotal = computed(() => formatDuration(this.store.shiftMinutes()));

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

  protected statusKey(status: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${status}`;
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected async startShift(): Promise<void> {
    await this.run(async () => {
      const entry = await this.store.startShift();
      this.toast.success(this.i18n.t('shift.startedToast', { time: this.i18n.time(entry.startedAt) }));
    });
  }

  protected async endShift(): Promise<void> {
    await this.run(async () => {
      const minutes = await this.store.endShift();
      this.toast.success(this.i18n.t('shift.endedToast', { time: this.i18n.time(Date.now()), duration: formatDuration(minutes) }));
    });
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
