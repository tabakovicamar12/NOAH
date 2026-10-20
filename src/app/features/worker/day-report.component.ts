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
  imports: [RouterLink, HoldButtonComponent, IconComponent, ReportStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-page">
      <header class="head">
        <div class="min-w-0">
          <h1 class="w-h1">{{ i18n.t('day.title') }}</h1>
          <p class="w-small w-muted mt-0.5">{{ i18n.dateLong(store.today()) }} · {{ session.user()?.displayName }}</p>
        </div>
        <aon-report-status [status]="status()" />
      </header>

      <div class="w-stack mt-3">
        @if (summary(); as s) {
          @if (s.status === 'RETURNED') {
            <section class="w-alert" role="status">
              <aon-icon name="alert" [size]="18" />
              <span>
                <span class="block font-semibold">{{ i18n.t('day.returned') }}</span>
                @if (s.reviewerNote) {
                  <span class="mt-0.5 block text-[var(--color-text)]">»{{ s.reviewerNote }}«</span>
                }
                <span class="mt-0.5 block w-small">{{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.time(s.reviewedAt) }) }}</span>
              </span>
            </section>
          }
        }

        @if (!hasDay()) {
          <section class="w-card">
            <p class="font-semibold">{{ i18n.t('day.nothing') }}</p>
            <p class="w-small w-muted mt-1">{{ i18n.t('day.nothingHint') }}</p>
            <a routerLink="/w/orders" class="w-btn w-btn-dark mt-3">{{ i18n.t('day.toOrders') }}<aon-icon name="chevron-right" [size]="18" [stroke]="2.25" /></a>
          </section>
        } @else {
          <!-- Locked times: stamped by the ZAČNI / KONČAJ DELO holds, never typed -->
          <section class="w-card" aria-labelledby="times-title">
            <h2 id="times-title" class="locked"><aon-icon name="shield" [size]="14" [stroke]="2" />{{ i18n.t('day.lockedTimes') }}</h2>
            <dl class="w-stats mt-2.5">
              <div>
                <dt>{{ i18n.t('day.arrival') }}</dt>
                <dd>{{ i18n.time(view().arrivalAt) }}</dd>
              </div>
              <div>
                <dt>{{ i18n.t('day.departure') }}</dt>
                <dd [class.still]="!view().departureAt">{{ view().departureAt ? i18n.time(view().departureAt) : i18n.t('day.stillWorking') }}</dd>
              </div>
              <div>
                <dt>{{ i18n.t('day.hours') }}</dt>
                <dd class="hours">{{ duration(view().shiftMinutes) }}</dd>
              </div>
            </dl>
            @if (view().siteName; as site) {
              <p class="w-small mt-2.5 flex items-start gap-1.5"><aon-icon name="pin" [size]="15" class="mt-0.5" /><span><span class="w-muted">{{ i18n.t('site.label') }}:</span> {{ site }}</span></p>
            }
            @if (view().declaredEnd) {
              <p class="w-small mt-2.5 flex items-start gap-1.5 text-[var(--color-bad-ink)]"><aon-icon name="clock" [size]="15" class="mt-0.5" />{{ i18n.t('day.declaredEnd') }}</p>
            }

            @if (draft().corrections.length) {
              <ul class="w-rows mt-3">
                @for (c of draft().corrections; track $index) {
                  <li class="corr">
                    <span class="min-w-0">
                      <span class="w-small w-muted block">{{ i18n.t('day.correctionTitle') }}</span>
                      <span class="block font-semibold">
                        {{ i18n.t(c.field === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}: {{ i18n.time(c.recordedAt) }} → {{ i18n.time(c.proposedAt) }}
                      </span>
                      <span class="w-small w-muted block">{{ c.reason }}</span>
                    </span>
                    @if (editable()) {
                      <button type="button" class="icon-btn" [attr.aria-label]="i18n.t('common.remove')" (click)="removeCorrection($index)">
                        <aon-icon name="x" [size]="18" />
                      </button>
                    }
                  </li>
                }
              </ul>
            }

            @if (editable()) {
              @if (!correcting()) {
                <button type="button" class="w-btn w-btn-quiet mt-1.5" (click)="openCorrection()">
                  <aon-icon name="clock" [size]="16" />{{ i18n.t('day.timeWrong') }}
                </button>
              } @else {
                <div class="corr-form mt-3">
                  <p class="w-small leading-snug">{{ i18n.t('day.correctionHint') }}</p>
                  <div class="w-seg" role="group" [attr.aria-label]="i18n.t('day.correctionTitle')">
                    @for (f of correctionFields; track f) {
                      <button
                        type="button"
                        [attr.aria-pressed]="corrField() === f"
                        [disabled]="f === 'DEPARTURE' && !view().departureAt"
                        (click)="corrField.set(f)"
                      >
                        {{ i18n.t(f === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}
                      </button>
                    }
                  </div>
                  <label class="block">
                    <span class="w-label">{{ i18n.t('day.correctTime') }}</span>
                    <input type="time" class="w-field" [value]="corrTime()" (input)="corrTime.set($any($event.target).value)" />
                  </label>
                  <label class="block">
                    <span class="w-label">{{ i18n.t('stale.reasonLabel') }}</span>
                    <textarea rows="2" maxlength="500" class="w-field" [value]="corrReason()" (input)="corrReason.set($any($event.target).value)"></textarea>
                  </label>
                  <div class="w-pair">
                    <button type="button" class="w-btn w-btn-line" (click)="correcting.set(false)">{{ i18n.t('common.cancel') }}</button>
                    <button type="button" class="w-btn w-btn-dark" (click)="addCorrection()">{{ i18n.t('day.addCorrection') }}</button>
                  </div>
                </div>
              }
            }
          </section>

          <!-- Orders worked today -->
          <section aria-labelledby="lines-title">
            <h2 id="lines-title" class="w-h2">
              {{ i18n.t('day.ordersWorked') }}
              <small>{{ i18n.t('day.onOrdersTotal', { duration: duration(view().orderMinutes) }) }}</small>
            </h2>

            @for (line of view().lines; track line.workOrderId) {
              <article class="w-card mt-2.5" [attr.aria-label]="line.code ?? line.title">
                <div class="line-head">
                  <div class="min-w-0">
                    <p class="line-title"><span class="code">{{ line.code }}</span> · {{ line.title }}</p>
                    <p class="w-small w-muted truncate">{{ line.siteName }}</p>
                  </div>
                  <p class="line-time">{{ duration(line.minutes) }}</p>
                </div>
                <p class="w-small w-muted mt-1.5">
                  {{ i18n.t('order.quantityTitle') }} <b class="text-[var(--color-text)]">{{ i18n.number(line.quantity) }} {{ i18n.t(unitKey(line.unit)) }}</b>
                  · {{ i18n.t('day.photos') }} <b class="text-[var(--color-text)]">{{ line.photoCount }}</b>
                </p>

                @if (line.issues.length) {
                  <ul class="mt-2.5 grid gap-1.5">
                    @for (issue of line.issues; track $index) {
                      <li class="w-alert"><aon-icon name="alert" [size]="16" />{{ issue }}</li>
                    }
                  </ul>
                }

                <div class="w-rule"></div>
                <label class="block">
                  <span class="w-label">{{ i18n.t('day.workDone') }}</span>
                  @if (editable()) {
                    <textarea
                      rows="3"
                      maxlength="4000"
                      class="w-field"
                      [placeholder]="i18n.t('day.workDonePlaceholder')"
                      [value]="workDone(line)"
                      (input)="setWorkDone(line.workOrderId, $any($event.target).value)"
                    ></textarea>
                  } @else {
                    <span class="mt-0.5 block whitespace-pre-line leading-snug">{{ line.workDone || i18n.t('common.none') }}</span>
                  }
                </label>

                <div class="mt-3">
                  <p class="w-label">{{ i18n.t('day.materialsUsed') }}</p>
                  @if (editable()) {
                    <ul class="mt-1 grid gap-1.5">
                      @for (m of materials(line); track $index; let i = $index) {
                        <li class="mat">
                          <input
                            type="text"
                            class="w-field is-flush"
                            [attr.aria-label]="i18n.t('form.materialName')"
                            [value]="m.name"
                            (input)="setMaterial(line, i, { name: $any($event.target).value })"
                          />
                          <input
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="any"
                            class="w-field is-flush text-right tabular-nums"
                            [attr.aria-label]="i18n.t('form.materialQty', { name: m.name })"
                            [placeholder]="i18n.t('day.qtyPlaceholder')"
                            [value]="m.qty ?? ''"
                            (input)="setMaterial(line, i, { qty: parseQty($any($event.target).value) })"
                          />
                          <input
                            type="text"
                            class="w-field is-flush is-tight text-center"
                            [attr.aria-label]="i18n.t('form.materialUnit')"
                            [value]="m.unit ?? ''"
                            (input)="setMaterial(line, i, { unit: $any($event.target).value || null })"
                          />
                        </li>
                      }
                    </ul>
                    <button type="button" class="w-btn w-btn-quiet mt-1" (click)="addMaterial(line)">
                      <aon-icon name="plus" [size]="16" [stroke]="2.25" />{{ i18n.t('form.addMaterial') }}
                    </button>
                  } @else {
                    <ul class="w-rows mt-1">
                      @for (m of line.materialsUsed; track $index) {
                        <li class="w-row"><span>{{ m.name }}</span><span class="font-semibold tabular-nums">{{ m.qty !== null ? i18n.number(m.qty) : '' }} {{ m.unit ?? '' }}</span></li>
                      } @empty {
                        <li class="w-muted">{{ i18n.t('common.none') }}</li>
                      }
                    </ul>
                  }
                </div>
              </article>
            } @empty {
              <p class="w-small w-muted mt-2">{{ i18n.t('day.noOrders') }}</p>
            }
          </section>

          <section class="w-card" aria-labelledby="comment-title">
            <h2 id="comment-title" class="w-h2">{{ i18n.t('day.comment') }}</h2>
            @if (editable()) {
              <textarea
                rows="3"
                maxlength="2000"
                class="w-field mt-2"
                [placeholder]="i18n.t('day.commentPlaceholder')"
                [value]="draft().comment"
                (input)="patch({ comment: $any($event.target).value })"
              ></textarea>
              <p class="w-small w-muted mt-2 flex items-center gap-1.5" aria-live="polite">
                <aon-icon [name]="saving() ? 'refresh' : 'check'" [size]="14" />{{ saving() ? i18n.t('day.savingDraft') : i18n.t('day.draftSaved') }}
              </p>
            } @else {
              <p class="mt-1.5 whitespace-pre-line leading-snug">{{ summary()?.comment || i18n.t('common.none') }}</p>
            }
          </section>

          @if (summary(); as s) {
            @if (s.status === 'APPROVED') {
              <div class="w-alert is-ok" role="status">
                <aon-icon name="circle-check" [size]="20" />
                <span>
                  <span class="block font-semibold">{{ i18n.t('day.stampApproved') }}</span>
                  <span class="block w-small">{{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.time(s.reviewedAt) }) }}</span>
                </span>
              </div>
            } @else if (s.status === 'SUBMITTED') {
              <p class="w-alert is-info" role="status">
                <aon-icon [name]="s.synced ? 'circle-check' : 'refresh'" [size]="18" />
                {{ s.synced ? i18n.t('day.submitted', { time: i18n.time(s.submittedAt) }) : i18n.t('day.submittedPending') }}
              </p>
            }
          }
        }
      </div>
    </div>

    @if (hasDay() && editable()) {
      <div class="w-slab">
        @if (store.openShift()) {
          <p class="w-small w-muted mb-1.5 text-center">{{ i18n.t('day.needEnd') }}</p>
          <a routerLink="/w/orders" class="w-btn w-btn-dark">{{ i18n.t('day.toOrders') }}<aon-icon name="chevron-right" [size]="18" [stroke]="2.25" /></a>
        } @else {
          <aon-hold-button
            tone="gold"
            [height]="56"
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
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .head aon-report-status {
      margin-top: 0.3rem;
    }
    .locked {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.8rem;
      font-weight: 400;
    }
    .w-stats dd.still {
      font-size: 0.95rem;
      line-height: 1.6;
    }
    .w-stats dd.hours {
      color: var(--color-gold-ink);
    }
    .corr {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.6rem 0;
    }
    .icon-btn {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 0.5rem;
      color: var(--color-text-muted);
    }
    .corr-form {
      display: grid;
      gap: 0.65rem;
      padding: 0.8rem;
      border-radius: 0.6rem;
      background: var(--color-row-tint);
      box-shadow: inset 0 0 0 1px var(--color-line);
    }
    .line-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .line-title {
      font-weight: 600;
      line-height: 1.3;
    }
    .line-time {
      flex: 0 0 auto;
      font-size: 1.35rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .mat {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 4.75rem 3.25rem;
      gap: 0.35rem;
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
      return {
        arrivalAt: s.arrivalAt,
        departureAt: s.departureAt,
        siteName: s.siteName ?? null,
        shiftMinutes: s.shiftMinutes,
        orderMinutes: s.orderMinutes,
        declaredEnd: s.declaredEnd,
        lines: s.lines,
      };
    }
    return {
      arrivalAt: this.store.arrivalAt(),
      departureAt: this.store.departureAt(),
      siteName: this.store.daySiteNames(),
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
