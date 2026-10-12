import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { DailySummaryStatus, Material, QuantityUnit, ReportOrderLine, TimeCorrection } from '../../core/models/domain.models';
import { ToastService } from '../../core/ui/toast.service';
import { formatDuration } from '../../core/util/util';
import { HoldButtonComponent } from '../../shared/ui/hold-button.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { VoiceButtonComponent } from '../../shared/ui/voice-button.component';
import { WorkerStore, type ReportDraft } from './data/worker-store.service';
import { workflowMessage } from './data/workflow-messages';

const SAVE_DELAY_MS = 500;

/** `HH:MM` local time for a time input. */
function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Dnevno poročilo. Times and quantities come from what was recorded during the day and are locked;
 * the worker writes what was done, the materials used and a comment, then submits it for review.
 */
@Component({
  selector: 'aon-day-report',
  imports: [RouterLink, HoldButtonComponent, IconComponent, ReportStatusComponent, VoiceButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-4 pb-8 pt-4">
      <header class="border-b-2 border-charcoal pb-3">
        <h1 class="font-cond-tight text-[2.5rem] leading-none">{{ i18n.t('day.title') }}</h1>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p class="font-semibold text-ink-muted">{{ i18n.dateLong(store.today()) }} · {{ session.user()?.displayName }}</p>
          <aon-report-status [status]="status()" />
        </div>
      </header>

      @if (summary(); as s) {
        @if (s.status === 'RETURNED') {
          <section class="mt-4 border-2 border-hold bg-hold-pale px-4 py-3" role="status">
            <p class="flex items-center gap-2 font-cond text-xl text-hold-ink"><aon-icon name="alert" [size]="22" />{{ i18n.t('day.returned') }}</p>
            @if (s.reviewerNote) {
              <p class="mt-1 text-lg font-semibold leading-snug">»{{ s.reviewerNote }}«</p>
            }
            <p class="mt-1 text-sm font-semibold text-hold-ink">{{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.time(s.reviewedAt) }) }}</p>
          </section>
        }
      }

      @if (!hasDay()) {
        <section class="mt-6 border-2 border-dashed border-charcoal px-5 py-6">
          <p class="font-cond text-2xl">{{ i18n.t('day.nothing') }}</p>
          <p class="mt-1 text-ink-muted">{{ i18n.t('day.nothingHint') }}</p>
          <a routerLink="/w/orders" class="mt-4 flex min-h-14 items-center justify-between bg-charcoal px-5 font-cond text-xl text-white no-underline">
            {{ i18n.t('day.toOrders') }}<aon-icon name="chevron-right" [size]="24" [stroke]="2.75" />
          </a>
        </section>
      } @else {
        <!-- Locked times -->
        <section class="mt-5" aria-labelledby="times-title">
          <h2 id="times-title" class="flex items-center gap-2 label-caps text-ink-muted"><aon-icon name="shield" [size]="16" />{{ i18n.t('day.lockedTimes') }}</h2>
          <dl class="mt-2 grid grid-cols-3 border-2 border-charcoal bg-stock">
            <div class="border-r-2 border-charcoal px-3 py-3">
              <dt class="label-caps text-ink-muted">{{ i18n.t('day.arrival') }}</dt>
              <dd class="mt-1 font-cond-tight text-[2rem] leading-none">{{ i18n.time(view().arrivalAt) }}</dd>
            </div>
            <div class="border-r-2 border-charcoal px-3 py-3">
              <dt class="label-caps text-ink-muted">{{ i18n.t('day.departure') }}</dt>
              <dd class="mt-1 font-cond-tight text-[2rem] leading-none">{{ view().departureAt ? i18n.time(view().departureAt) : i18n.t('day.stillWorking') }}</dd>
            </div>
            <div class="bg-charcoal px-3 py-3 text-white">
              <dt class="label-caps text-on-dark-muted">{{ i18n.t('day.hours') }}</dt>
              <dd class="mt-1 font-cond-tight text-[2rem] leading-none">{{ duration(view().shiftMinutes) }}</dd>
            </div>
          </dl>
          @if (view().declaredEnd) {
            <p class="mt-2 flex items-start gap-2 text-sm font-semibold text-hold-ink"><aon-icon name="clock" [size]="16" class="mt-0.5" />{{ i18n.t('day.declaredEnd') }}</p>
          }

          @if (draft().corrections.length) {
            <ul class="mt-3 grid gap-2">
              @for (c of draft().corrections; track $index) {
                <li class="flex items-start justify-between gap-3 border-2 border-dashed border-charcoal bg-stock px-4 py-3">
                  <span>
                    <span class="block label-caps text-ink-muted">{{ i18n.t('day.correctionTitle') }}</span>
                    <span class="block font-semibold">
                      {{ i18n.t(c.field === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}: {{ i18n.time(c.recordedAt) }} → {{ i18n.time(c.proposedAt) }}
                    </span>
                    <span class="block text-[0.95rem] text-ink-muted">{{ c.reason }}</span>
                  </span>
                  @if (editable()) {
                    <button type="button" class="grid size-12 shrink-0 place-items-center ring-2 ring-inset ring-charcoal" [attr.aria-label]="i18n.t('common.remove')" (click)="removeCorrection($index)">
                      <aon-icon name="x" [size]="20" />
                    </button>
                  }
                </li>
              }
            </ul>
          }

          @if (editable()) {
            @if (!correcting()) {
              <button type="button" class="mt-2 flex min-h-12 items-center gap-2 px-1 font-cond text-lg underline decoration-2 underline-offset-4" (click)="openCorrection()">
                <aon-icon name="clock" [size]="18" />{{ i18n.t('day.timeWrong') }}
              </button>
            } @else {
              <div class="mt-3 grid gap-3 border-2 border-charcoal bg-stock px-4 py-4">
                <p class="font-semibold leading-snug">{{ i18n.t('day.correctionHint') }}</p>
                <div class="grid grid-cols-2 border-2 border-charcoal" role="group" [attr.aria-label]="i18n.t('day.correctionTitle')">
                  @for (f of correctionFields; track f) {
                    <button
                      type="button"
                      class="min-h-14 font-cond text-lg"
                      [class]="corrField() === f ? 'bg-charcoal text-white' : 'bg-stock'"
                      [attr.aria-pressed]="corrField() === f"
                      [disabled]="f === 'DEPARTURE' && !view().departureAt"
                      (click)="corrField.set(f)"
                    >
                      {{ i18n.t(f === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}
                    </button>
                  }
                </div>
                <label class="block">
                  <span class="label-caps text-ink-muted">{{ i18n.t('day.correctTime') }}</span>
                  <input type="time" class="mt-1 block min-h-14 w-full border-2 border-charcoal bg-white px-3 font-cond text-2xl outline-none focus:ring-4 focus:ring-gold" [value]="corrTime()" (input)="corrTime.set($any($event.target).value)" />
                </label>
                <label class="block">
                  <span class="label-caps text-ink-muted">{{ i18n.t('stale.reasonLabel') }}</span>
                  <textarea rows="2" maxlength="500" class="mt-1 block w-full border-2 border-charcoal bg-white px-3 py-2 text-lg outline-none focus:ring-4 focus:ring-gold" [value]="corrReason()" (input)="corrReason.set($any($event.target).value)"></textarea>
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <button type="button" class="min-h-14 bg-charcoal font-cond text-lg text-white" (click)="addCorrection()">{{ i18n.t('day.addCorrection') }}</button>
                  <button type="button" class="min-h-14 bg-stock font-cond text-lg ring-2 ring-inset ring-charcoal" (click)="correcting.set(false)">{{ i18n.t('common.cancel') }}</button>
                </div>
              </div>
            }
          }
        </section>

        <!-- Orders worked today -->
        <section class="mt-8" aria-labelledby="lines-title">
          <div class="flex items-baseline justify-between border-b-2 border-charcoal pb-1">
            <h2 id="lines-title" class="font-cond text-2xl">{{ i18n.t('day.ordersWorked') }}</h2>
            <span class="font-cond text-xl">{{ i18n.t('day.onOrdersTotal', { duration: duration(view().orderMinutes) }) }}</span>
          </div>

          @for (line of view().lines; track line.workOrderId) {
            <article class="mt-4 border-2 border-charcoal bg-stock" [attr.aria-label]="line.code ?? line.title">
              <div class="flex items-start justify-between gap-3 bg-charcoal px-4 py-2.5 text-white">
                <div class="min-w-0">
                  <p class="font-cond-tight text-2xl leading-none">{{ line.code }}</p>
                  <p class="mt-1 truncate font-semibold">{{ line.title }}</p>
                  <p class="truncate text-sm text-on-dark-muted">{{ line.siteName }}</p>
                </div>
                <p class="shrink-0 text-right font-cond-tight text-[2rem] leading-none text-gold">{{ duration(line.minutes) }}</p>
              </div>
              <dl class="grid grid-cols-2 border-b-2 border-charcoal">
                <div class="border-r-2 border-charcoal px-4 py-2">
                  <dt class="label-caps text-ink-muted">{{ i18n.t('order.quantityTitle') }}</dt>
                  <dd class="font-cond text-xl">{{ i18n.number(line.quantity) }} {{ i18n.t(unitKey(line.unit)) }}</dd>
                </div>
                <div class="px-4 py-2">
                  <dt class="label-caps text-ink-muted">{{ i18n.t('day.photos') }}</dt>
                  <dd class="font-cond text-xl">{{ line.photoCount }}</dd>
                </div>
              </dl>

              <div class="grid gap-4 px-4 py-4">
                @if (line.issues.length) {
                  <ul class="grid gap-1.5">
                    @for (issue of line.issues; track $index) {
                      <li class="flex items-start gap-2 bg-hold-pale px-3 py-2 font-semibold text-hold-ink"><aon-icon name="alert" [size]="18" class="mt-0.5" />{{ issue }}</li>
                    }
                  </ul>
                }

                <label class="block">
                  <span class="label-caps text-ink-muted">{{ i18n.t('day.workDone') }}</span>
                  @if (editable()) {
                    <textarea
                      rows="3"
                      maxlength="4000"
                      class="mt-1 block w-full border-2 border-charcoal bg-white px-3 py-2 text-lg leading-snug outline-none placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
                      [placeholder]="i18n.t('day.workDonePlaceholder')"
                      [value]="workDone(line)"
                      (input)="setWorkDone(line.workOrderId, $any($event.target).value)"
                    ></textarea>
                    <aon-voice-button class="mt-2" [compact]="true" (text)="appendWorkDone(line, $event)" />
                  } @else {
                    <span class="mt-1 block whitespace-pre-line text-lg leading-snug">{{ line.workDone || i18n.t('common.none') }}</span>
                  }
                </label>

                <div>
                  <p class="label-caps text-ink-muted">{{ i18n.t('day.materialsUsed') }}</p>
                  @if (editable()) {
                    <ul class="mt-1 grid gap-2">
                      @for (m of materials(line); track $index; let i = $index) {
                        <li class="grid grid-cols-[1fr_5.5rem_3.5rem] gap-1.5">
                          <input
                            type="text"
                            class="min-h-14 min-w-0 border-2 border-charcoal bg-white px-3 font-semibold outline-none focus:ring-4 focus:ring-gold"
                            [attr.aria-label]="i18n.t('form.materialName')"
                            [value]="m.name"
                            (input)="setMaterial(line, i, { name: $any($event.target).value })"
                          />
                          <input
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="any"
                            class="min-h-14 min-w-0 border-2 border-charcoal bg-white px-2 text-right font-cond text-xl outline-none focus:ring-4 focus:ring-gold"
                            [attr.aria-label]="i18n.t('form.materialQty', { name: m.name })"
                            [placeholder]="i18n.t('day.qtyPlaceholder')"
                            [value]="m.qty ?? ''"
                            (input)="setMaterial(line, i, { qty: parseQty($any($event.target).value) })"
                          />
                          <input
                            type="text"
                            class="min-h-14 min-w-0 border-2 border-charcoal bg-white px-2 text-center font-semibold outline-none focus:ring-4 focus:ring-gold"
                            [attr.aria-label]="i18n.t('form.materialUnit')"
                            [value]="m.unit ?? ''"
                            (input)="setMaterial(line, i, { unit: $any($event.target).value || null })"
                          />
                        </li>
                      }
                    </ul>
                    <button type="button" class="mt-2 flex min-h-12 items-center gap-2 px-1 font-cond text-lg underline decoration-2 underline-offset-4" (click)="addMaterial(line)">
                      <aon-icon name="plus" [size]="18" [stroke]="3" />{{ i18n.t('form.addMaterial') }}
                    </button>
                  } @else {
                    <ul class="mt-1">
                      @for (m of line.materialsUsed; track $index) {
                        <li class="flex justify-between gap-3 border-b border-rule-soft py-1.5"><span class="font-semibold">{{ m.name }}</span><span class="font-cond text-lg">{{ m.qty !== null ? i18n.number(m.qty) : '' }} {{ m.unit ?? '' }}</span></li>
                      } @empty {
                        <li class="text-ink-muted">{{ i18n.t('common.none') }}</li>
                      }
                    </ul>
                  }
                </div>
              </div>
            </article>
          } @empty {
            <p class="mt-3 text-ink-muted">{{ i18n.t('day.noOrders') }}</p>
          }
        </section>

        <section class="mt-8" aria-labelledby="comment-title">
          <h2 id="comment-title" class="font-cond text-2xl">{{ i18n.t('day.comment') }}</h2>
          @if (editable()) {
            <textarea
              rows="3"
              maxlength="2000"
              class="mt-2 block w-full border-2 border-charcoal bg-white px-3 py-2 text-lg leading-snug outline-none placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
              [placeholder]="i18n.t('day.commentPlaceholder')"
              [value]="draft().comment"
              (input)="patch({ comment: $any($event.target).value })"
            ></textarea>
            <aon-voice-button class="mt-2" [compact]="true" (text)="appendComment($event)" />
            <p class="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink-muted" aria-live="polite">
              <aon-icon [name]="saving() ? 'refresh' : 'check'" [size]="14" />{{ saving() ? i18n.t('day.savingDraft') : i18n.t('day.draftSaved') }}
            </p>
          } @else {
            <p class="mt-2 whitespace-pre-line text-lg leading-snug">{{ summary()?.comment || i18n.t('common.none') }}</p>
          }
        </section>

        @if (summary(); as s) {
          @if (s.status === 'APPROVED') {
            <div class="mt-8 flex items-center gap-3 border-[3px] border-done px-4 py-3 text-done" role="status">
              <aon-icon name="circle-check" [size]="34" [stroke]="2.5" />
              <p>
                <span class="block font-cond-tight text-3xl leading-none">{{ i18n.t('day.stampApproved') }}</span>
                <span class="block font-semibold text-ink">{{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.time(s.reviewedAt) }) }}</span>
              </p>
            </div>
          } @else if (s.status === 'SUBMITTED') {
            <p class="mt-8 flex items-center gap-2 border-2 bg-stock px-4 py-3 font-semibold" [class]="s.synced ? 'border-charcoal' : 'border-dashed border-charcoal'" role="status">
              <aon-icon [name]="s.synced ? 'circle-check' : 'refresh'" [size]="20" [class]="s.synced ? 'text-done' : ''" />
              {{ s.synced ? i18n.t('day.submitted', { time: i18n.time(s.submittedAt) }) : i18n.t('day.submittedPending') }}
            </p>
          }
        }
      }
    </div>

    @if (hasDay() && editable()) {
      <div class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t-2 border-charcoal bg-ground px-4 pb-3 pt-3">
        @if (store.openShift()) {
          <p class="mb-2 font-semibold text-ink-muted">{{ i18n.t('day.needEnd') }}</p>
          <a routerLink="/w/orders" class="flex min-h-16 items-center justify-between bg-charcoal px-5 font-cond text-xl text-white no-underline">
            {{ i18n.t('day.toOrders') }}<aon-icon name="chevron-right" [size]="24" [stroke]="2.75" />
          </a>
        } @else {
          <aon-hold-button
            tone="gold"
            [label]="summary()?.status === 'RETURNED' ? i18n.t('day.resubmit') : i18n.t('day.submit')"
            [hint]="i18n.t('shift.holdHint')"
            [ariaLabel]="i18n.t('shift.holdAria', { label: i18n.t('day.submit') })"
            [disabled]="busy()"
            (confirmed)="submit()"
          />
        }
      </div>
    }
  `,
})
export class DayReportComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(WorkerStore);
  protected readonly session = inject(SessionStore);
  private readonly toast = inject(ToastService);

  protected readonly correctionFields = ['ARRIVAL', 'DEPARTURE'] as const;
  protected readonly busy = signal(false);
  protected readonly saving = signal(false);
  protected readonly correcting = signal(false);
  protected readonly corrField = signal<TimeCorrection['field']>('ARRIVAL');
  protected readonly corrTime = signal('');
  protected readonly corrReason = signal('');

  /** Local edits win over the stored draft while the screen is open, so the caret never jumps. */
  private readonly local = signal<ReportDraft | null>(null);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly summary = this.store.summary;
  protected readonly editable = this.store.reportEditable;
  protected readonly draft = computed(() => this.local() ?? this.store.draft());

  protected readonly status = computed<DailySummaryStatus>(() => this.summary()?.status ?? 'DRAFT');

  /** Live records while editable; the submitted record once it is with the manager. */
  protected readonly view = computed(() => {
    const s = this.summary();
    if (s && !this.editable()) {
      return { arrivalAt: s.arrivalAt, departureAt: s.departureAt, shiftMinutes: s.shiftMinutes, orderMinutes: s.orderMinutes, declaredEnd: s.declaredEnd, lines: s.lines };
    }
    return {
      arrivalAt: this.store.arrivalAt(),
      departureAt: this.store.departureAt(),
      shiftMinutes: this.store.shiftMinutes(),
      orderMinutes: this.store.orderMinutes(),
      declaredEnd: this.store.declaredEnd(),
      lines: this.store.reportLines(),
    };
  });
  protected readonly hasDay = computed(() => !!this.summary() || this.store.arrivalAt() !== null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        void this.flush();
      }
    });
  }

  protected duration(minutes: number): string {
    return formatDuration(minutes);
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected workDone(line: ReportOrderLine): string {
    return this.draft().workDone[line.workOrderId] ?? line.workDone;
  }

  protected materials(line: ReportOrderLine): readonly Material[] {
    return this.draft().materials[line.workOrderId] ?? line.materialsUsed;
  }

  protected parseQty(raw: string): number | null {
    const n = Number(String(raw).replace(',', '.'));
    return raw === '' || !Number.isFinite(n) || n < 0 ? null : n;
  }

  protected setWorkDone(orderId: string, text: string): void {
    this.patch({ workDone: { ...this.draft().workDone, [orderId]: text } });
  }

  protected appendWorkDone(line: ReportOrderLine, phrase: string): void {
    const current = this.workDone(line).trimEnd();
    this.setWorkDone(line.workOrderId, current ? `${current} ${phrase}` : phrase);
  }

  protected appendComment(phrase: string): void {
    const current = this.draft().comment.trimEnd();
    this.patch({ comment: current ? `${current} ${phrase}` : phrase });
  }

  protected setMaterial(line: ReportOrderLine, index: number, change: Partial<Material>): void {
    const list = this.materials(line).map((m, i) => (i === index ? { ...m, ...change } : m));
    this.patch({ materials: { ...this.draft().materials, [line.workOrderId]: list } });
  }

  protected addMaterial(line: ReportOrderLine): void {
    const list = [...this.materials(line), { name: '', qty: null, unit: null }];
    this.patch({ materials: { ...this.draft().materials, [line.workOrderId]: list } });
  }

  protected openCorrection(): void {
    const at = this.view().arrivalAt;
    this.corrField.set('ARRIVAL');
    this.corrTime.set(at ? toTimeInput(at) : '');
    this.corrReason.set('');
    this.correcting.set(true);
  }

  protected addCorrection(): void {
    const field = this.corrField();
    const recordedAt = field === 'ARRIVAL' ? this.view().arrivalAt : this.view().departureAt;
    const [h, m] = this.corrTime().split(':').map(Number);
    const reason = this.corrReason().trim();
    if (h === undefined || m === undefined || !Number.isFinite(h) || !Number.isFinite(m)) {
      this.toast.error(this.i18n.t('stale.invalidTime'));
      return;
    }
    if (!reason) {
      this.toast.error(this.i18n.t('stale.reasonRequired'));
      return;
    }
    const proposed = new Date(`${this.store.today()}T00:00:00`);
    proposed.setHours(h, m, 0, 0);
    const correction: TimeCorrection = { field, recordedAt, proposedAt: proposed.getTime(), reason: reason.slice(0, 500) };
    this.patch({ corrections: [...this.draft().corrections.filter((c) => c.field !== field), correction] });
    this.correcting.set(false);
  }

  protected removeCorrection(index: number): void {
    this.patch({ corrections: this.draft().corrections.filter((_, i) => i !== index) });
  }

  protected patch(change: Partial<ReportDraft>): void {
    this.local.set({ ...this.draft(), ...change });
    this.saving.set(true);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      await this.flush();
      await this.store.submitReport(this.draft());
      this.local.set(null);
      this.toast.success(this.i18n.t('day.submittedToast'));
    } catch (err: unknown) {
      this.toast.error(workflowMessage(this.i18n, err));
    } finally {
      this.busy.set(false);
    }
  }

  private async flush(): Promise<void> {
    this.saveTimer = null;
    const draft = this.local();
    if (!draft) {
      this.saving.set(false);
      return;
    }
    try {
      await this.store.saveDraft(draft);
    } catch (err: unknown) {
      this.toast.error(workflowMessage(this.i18n, err));
    } finally {
      this.saving.set(false);
    }
  }
}
