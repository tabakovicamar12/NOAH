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
import { HoldButtonComponent } from '../../shared/ui/hold-button.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { TAG_FILL, progressRatio } from '../../shared/ui/tag-style';
import { VoiceButtonComponent } from '../../shared/ui/voice-button.component';
import { WorkerStore } from './data/worker-store.service';
import { orderElapsedMs, workflowMessage } from './data/workflow-messages';
import { OrderPhotosComponent } from './photo/order-photos.component';

const QUICK_STEPS: Readonly<Record<QuantityUnit, readonly number[]>> = {
  PCS: [1, 2, 5],
  M: [1, 5, 10],
  M2: [1, 5, 10],
  M3: [0.5, 1, 2],
  H: [0.5, 1, 2],
};

type NoteMode = 'NOTE' | 'ISSUE';

@Component({
  selector: 'aon-order-detail',
  imports: [FormsModule, RouterLink, HoldButtonComponent, IconComponent, OrderPhotosComponent, VoiceButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-4 pb-8 pt-3">
      <a routerLink="/w/orders" class="-ml-1 inline-flex min-h-14 items-center gap-2 px-1 font-cond text-xl text-ink no-underline">
        <aon-icon name="arrow-left" [size]="24" [stroke]="2.75" />{{ i18n.t('order.backToList') }}
      </a>

      @if (order(); as o) {
        @let fill = TAG_FILL[o.status];
        <section class="tag-shape mt-1 py-5 pr-4" [class]="fill.cls" aria-labelledby="order-code">
          <span class="tag-eyelet"></span>
          <div class="flex items-start justify-between gap-3">
            <h1 id="order-code" class="font-cond-tight text-code leading-none">{{ o.code }}</h1>
            <span class="flex items-center gap-1.5 label-caps" [class]="fill.muted">
              <aon-icon [name]="running() ? 'timer' : fill.icon" [size]="16" [stroke]="3" />
              {{ running() ? i18n.t('orders.running') : i18n.t(statusKey(o.status)) }}
            </span>
          </div>
          <p class="mt-1 text-xl font-bold leading-snug">{{ o.title }}</p>
          <p class="mt-1 flex items-center gap-1.5 font-semibold" [class]="fill.muted">
            <aon-icon name="pin" [size]="16" />{{ o.location }} · {{ o.siteName }}
          </p>
          @if (o.dueDate) {
            <p class="mt-0.5 font-semibold" [class]="fill.muted">{{ i18n.t('orders.due', { date: i18n.date(o.dueDate) }) }}</p>
          }
          @if (crewmates().length) {
            <p class="mt-2 flex items-center gap-1.5 font-semibold" [class]="fill.muted">
              <aon-icon name="users" [size]="16" />{{ i18n.t('order.withCrew', { names: crewmates().join(', ') }) }}
            </p>
          }
        </section>

        <!-- Sync receipt -->
        <p
          class="flex items-center gap-2 border-2 border-t-0 border-charcoal bg-stock px-4 py-2 label-caps"
          [class.border-dashed]="o.dirty === 1"
        >
          @if (o.dirty === 1) {
            <aon-icon name="refresh" [size]="16" />{{ i18n.t('order.pending') }}
          } @else {
            <aon-icon name="circle-check" [size]="16" class="text-done" />{{ i18n.t('orders.synced') }}
          }
        </p>

        <!-- Time -->
        <div class="mt-5 flex items-end justify-between gap-3 border-b-2 border-charcoal pb-2">
          <span class="label-caps text-ink-muted">{{ i18n.t('order.timeOnOrder') }}</span>
          <span class="font-cond-tight text-5xl leading-none" role="timer">{{ elapsed() }}</span>
        </div>

        <!-- Actions -->
        <div class="mt-4 grid gap-2.5">
          @if (o.status === 'COMPLETED') {
            <p class="flex items-start gap-2 bg-done-pale px-4 py-3 font-semibold text-ink">
              <aon-icon name="circle-check" [size]="22" class="text-done" />{{ i18n.t('order.completedNote') }}
            </p>
            @if (running()) {
              <!-- A crewmate finished the order while this worker's timer was still running. -->
              <button
                type="button"
                class="flex min-h-16 items-center justify-center gap-2 bg-charcoal font-cond text-2xl text-white disabled:opacity-50"
                [disabled]="busy()"
                (click)="pause()"
              >
                <aon-icon name="stop" [size]="24" [stroke]="2.75" />{{ i18n.t('order.stopMyTime') }}
              </button>
            }
          } @else {
            @if (o.status === 'ISSUE') {
              <p class="flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink">
                <aon-icon name="alert" [size]="22" />{{ i18n.t('order.issueNote') }}
              </p>
            }
            @if (store.staleShift()) {
              <p class="flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink">
                <aon-icon name="clock" [size]="22" />{{ i18n.t('stale.blocked') }}
              </p>
            } @else if (running()) {
              <button
                type="button"
                class="flex min-h-16 items-center justify-center gap-2 bg-stock font-cond text-2xl ring-2 ring-inset ring-charcoal disabled:opacity-50"
                [disabled]="busy()"
                (click)="pause()"
              >
                <aon-icon name="pause" [size]="26" [stroke]="2.75" />{{ i18n.t('order.pauseOrder') }}
              </button>
            } @else if (store.openShift()) {
              <button
                type="button"
                class="flex min-h-[5.5rem] items-center justify-between bg-gold px-6 font-cond text-[1.75rem] text-ink disabled:opacity-50"
                [disabled]="busy()"
                (click)="start()"
              >
                {{ o.status === 'NEW' ? i18n.t('order.startOrder') : i18n.t('order.resumeOrder') }}
                <aon-icon name="play" [size]="30" [stroke]="2.75" />
              </button>
            } @else {
              <p class="text-[0.95rem] font-semibold text-ink-muted">{{ i18n.t('order.needShift') }}</p>
              <aon-hold-button
                tone="gold"
                [label]="i18n.t('order.startShiftAndOrder')"
                [hint]="i18n.t('shift.holdHint')"
                [ariaLabel]="i18n.t('shift.holdAria', { label: i18n.t('order.startShiftAndOrder') })"
                [disabled]="busy()"
                (confirmed)="startShiftAndOrder()"
              />
            }
            @if (canFinish()) {
              <aon-hold-button
                tone="charcoal"
                [height]="80"
                [label]="i18n.t('order.finishOrder')"
                [hint]="i18n.t('shift.holdHint')"
                [ariaLabel]="i18n.t('shift.holdAria', { label: i18n.t('order.finishOrder') })"
                [disabled]="busy()"
                (confirmed)="finish()"
              />
              @if (crewmates().length) {
                <p class="text-sm font-semibold text-ink-muted">{{ i18n.t('order.finishCrewHint') }}</p>
              }
            }
          }
        </div>

        <!-- Quantity -->
        <section class="mt-8" aria-labelledby="qty-title">
          <div class="flex items-baseline justify-between">
            <h2 id="qty-title" class="font-cond text-2xl">{{ i18n.t('order.quantityTitle') }}</h2>
            <span class="font-cond text-2xl">
              {{ i18n.t('order.progress', { done: i18n.number(o.doneQty), planned: i18n.number(o.plannedQty), unit: unitLabel() }) }}
            </span>
          </div>
          <div class="mt-1.5 h-5 border-2 border-charcoal bg-stock" aria-hidden="true">
            <div class="h-full bg-gold" [style.width.%]="progressRatio(o.doneQty, o.plannedQty) * 100"></div>
          </div>

          @if (o.status !== 'COMPLETED') {
            <div class="mt-4 grid grid-cols-3 gap-2" role="group" [attr.aria-label]="i18n.t('order.quantityAria')">
              @for (step of steps(); track step) {
                <button
                  type="button"
                  class="min-h-16 bg-charcoal font-cond text-2xl text-white disabled:opacity-50"
                  [disabled]="busy()"
                  [attr.aria-label]="i18n.t('order.quantityAdd', { q: i18n.number(step), unit: unitLabel() })"
                  (click)="addQuantity(step)"
                >
                  +{{ i18n.number(step) }} <span class="text-lg text-on-dark-muted">{{ unitLabel() }}</span>
                </button>
              }
            </div>
            <form class="mt-2 grid grid-cols-[1fr_auto] gap-2" novalidate (ngSubmit)="addCustom()">
              <label class="block">
                <span class="sr-only">{{ i18n.t('order.quantityCustom') }}</span>
                <input
                  name="qty"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="any"
                  [placeholder]="i18n.t('order.quantityCustom')"
                  class="block min-h-16 w-full border-2 border-charcoal bg-stock px-4 font-cond text-2xl outline-none placeholder:font-sans placeholder:text-base placeholder:font-semibold placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
                  [ngModel]="custom()"
                  (ngModelChange)="custom.set($event)"
                />
              </label>
              <button type="submit" class="flex min-h-16 items-center gap-2 bg-gold px-5 font-cond text-xl text-ink disabled:opacity-50" [disabled]="busy()">
                <aon-icon name="plus" [size]="22" [stroke]="3" />{{ i18n.t('common.save') }}
              </button>
            </form>
          }
        </section>

        <aon-order-photos [order]="o" [orderLabel]="o.code ?? ''" />

        <!-- Notes and problems -->
        <section class="mt-8" aria-labelledby="notes-title">
          <h2 id="notes-title" class="border-b-2 border-charcoal pb-1 font-cond text-2xl">{{ i18n.t('order.notesTitle') }}</h2>
          @if (o.status !== 'COMPLETED') {
            <div class="mt-3 grid grid-cols-2 border-2 border-charcoal" role="group" [attr.aria-label]="i18n.t('order.notesTitle')">
              <button
                type="button"
                class="flex min-h-14 items-center justify-center gap-2 font-cond text-xl"
                [class]="mode() === 'NOTE' ? 'bg-charcoal text-white' : 'bg-stock'"
                [attr.aria-pressed]="mode() === 'NOTE'"
                (click)="mode.set('NOTE')"
              >
                <aon-icon name="note" [size]="20" />{{ i18n.t('order.noteMode') }}
              </button>
              <button
                type="button"
                class="flex min-h-14 items-center justify-center gap-2 font-cond text-xl"
                [class]="mode() === 'ISSUE' ? 'bg-hold text-white' : 'bg-stock text-hold-ink'"
                [attr.aria-pressed]="mode() === 'ISSUE'"
                (click)="mode.set('ISSUE')"
              >
                <aon-icon name="alert" [size]="20" />{{ i18n.t('order.issueMode') }}
              </button>
            </div>
            <label class="mt-2 block">
              <span class="sr-only">{{ mode() === 'ISSUE' ? i18n.t('order.issueMode') : i18n.t('order.noteMode') }}</span>
              <textarea
                rows="3"
                maxlength="2000"
                class="block w-full border-2 bg-stock px-4 py-3 text-lg leading-snug outline-none placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
                [class]="mode() === 'ISSUE' ? 'border-hold' : 'border-charcoal'"
                [placeholder]="mode() === 'ISSUE' ? i18n.t('order.issuePlaceholder') : i18n.t('order.notePlaceholder')"
                [value]="noteText()"
                (input)="noteText.set($any($event.target).value)"
              ></textarea>
            </label>
            <div class="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-2">
              <aon-voice-button (text)="appendNote($event)" />
              <button
                type="button"
                class="flex min-h-16 w-full items-center justify-center gap-2 px-2 font-cond text-xl disabled:opacity-50"
                [class]="mode() === 'ISSUE' ? 'bg-hold text-white' : 'bg-charcoal text-white'"
                [disabled]="busy()"
                (click)="saveNote()"
              >
                @if (mode() === 'ISSUE') {
                  <aon-icon name="alert" [size]="22" />{{ i18n.t('order.reportIssue') }}
                } @else {
                  <aon-icon name="check" [size]="22" />{{ i18n.t('order.saveNote') }}
                }
              </button>
            </div>
            @if (mode() === 'ISSUE') {
              <p class="mt-1.5 text-sm font-semibold text-ink-muted">{{ i18n.t('order.issueHint') }}</p>
            }
          }

          @if (myLogs().length) {
            <ol class="mt-4">
              @for (l of myLogs(); track l.id) {
                <li class="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-rule-soft py-2.5" [class.border-dashed]="!l.synced">
                  <span class="font-cond text-lg leading-tight" [class.text-hold-ink]="l.kind === 'ISSUE'">{{ i18n.time(l.createdAt) }}</span>
                  <span>
                    <span class="block label-caps" [class]="l.kind === 'ISSUE' ? 'text-hold-ink' : 'text-ink-muted'">
                      @switch (l.kind) {
                        @case ('QUANTITY') {
                          <span class="font-cond text-lg normal-case tracking-normal text-ink">{{ i18n.t('order.logQuantity', { q: i18n.number(l.quantity ?? 0), unit: unitLabel() }) }}</span>
                        }
                        @case ('ISSUE') {
                          {{ i18n.t('order.logIssue') }}
                        }
                        @default {
                          {{ i18n.t('order.logNote') }}
                        }
                      }
                    </span>
                    @if (l.text) {
                      <span class="block font-semibold leading-snug">{{ l.text }}</span>
                    }
                  </span>
                </li>
              }
            </ol>
          } @else {
            <p class="mt-3 text-[0.95rem] text-ink-muted">{{ i18n.t('order.timelineEmpty') }}</p>
          }
        </section>

        <!-- The order as written by the manager -->
        <section class="mt-8 border-t-2 border-charcoal pt-3">
          <h2 class="label-caps text-ink-muted">{{ i18n.t('order.description') }}</h2>
          <p class="mt-1 max-w-[65ch] text-[1.05rem] leading-relaxed">{{ o.description }}</p>
          <dl class="mt-4 grid grid-cols-2 border-2 border-charcoal bg-stock">
            <div class="border-b-2 border-r-2 border-charcoal px-4 py-3">
              <dt class="label-caps text-ink-muted">{{ i18n.t('order.estimate') }}</dt>
              <dd class="mt-0.5 font-cond text-2xl leading-none">{{ o.estimatedMinutes ? estimate(o.estimatedMinutes) : i18n.t('common.none') }}</dd>
            </div>
            <div class="border-b-2 border-charcoal px-4 py-3">
              <dt class="label-caps text-ink-muted">{{ i18n.t('order.plannedDate') }}</dt>
              <dd class="mt-0.5 font-semibold">{{ o.date ? i18n.date(o.date) : i18n.t('common.none') }}</dd>
            </div>
            <div class="col-span-2 px-4 py-3">
              <dt class="label-caps text-ink-muted">{{ i18n.t('order.manager') }}</dt>
              <dd class="mt-0.5 font-semibold">{{ o.managerName }}</dd>
            </div>
          </dl>
          @if (o.materials.length) {
            <h3 class="mt-5 label-caps text-ink-muted">{{ i18n.t('order.materials') }}</h3>
            <ul class="mt-1">
              @for (m of o.materials; track $index) {
                <li class="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2">
                  <span class="font-semibold">{{ m.name }}</span>
                  <span class="font-cond text-lg">{{ m.qty !== null ? i18n.number(m.qty) + ' ' + (m.unit ?? '') : i18n.t('common.none') }}</span>
                </li>
              }
            </ul>
          }
        </section>
      } @else {
        <div class="mt-4 border-2 border-charcoal bg-stock px-5 py-6">
          <p class="font-cond text-2xl">{{ i18n.t('order.notFound') }}</p>
        </div>
      }
    </div>
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

  protected readonly TAG_FILL = TAG_FILL;
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
      await this.store.startShift();
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

  protected addCustom(): Promise<void> {
    const raw = this.custom();
    const q = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      this.toast.error(this.i18n.t('order.quantityInvalid'));
      return Promise.resolve();
    }
    return this.addQuantity(q).then(() => this.custom.set(null));
  }

  protected appendNote(phrase: string): void {
    const current = this.noteText().trimEnd();
    this.noteText.set(current ? `${current} ${phrase}` : phrase);
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
