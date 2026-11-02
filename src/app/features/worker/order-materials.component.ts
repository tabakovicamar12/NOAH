import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LocalWorkOrder } from '../../core/db/aon-db';
import { I18nService } from '../../core/i18n/i18n.service';
import { materialLines, type MaterialLine } from '../../core/models/domain.models';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { WorkerStore } from './data/worker-store.service';
import { workflowMessage } from './data/workflow-messages';

/** Units a worker can pick for material that was not on the order. */
const EXTRA_UNITS = ['kos', 'm', 'm²', 'm³', 'kg', 't', 'l', 'kpl', 'pak'] as const;

function parseAmount(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw.trim().replace(',', '.'));
}

/**
 * The materials of an order as the crew uses them: what is planned, what the whole crew has used so far, and a tap
 * to add more. A mistake is taken back with a reason and the wrong entry stays in the history; material that was not
 * on the order can be added and is marked as such. Everything saves on the device first, like every other entry.
 */
@Component({
  selector: 'aon-order-materials',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="w-card" aria-labelledby="materials-title">
      <h2 id="materials-title" class="w-h2">{{ i18n.t('order.materials') }}</h2>
      @if (editable()) {
        <p class="w-small w-muted mt-0.5">{{ i18n.t('mat.hint') }}</p>
      } @else if (waiting()) {
        <p class="w-small w-muted mt-0.5">{{ i18n.t('order.startToLog') }}</p>
      }

      @if (lines().length) {
        <ul class="w-rows mt-2">
          @for (m of lines(); track m.key) {
            <li class="mat">
              <div class="mat-head">
                <span class="mat-name">
                  {{ m.name }}
                  @if (m.extra) {
                    <span class="mat-extra">{{ i18n.t('mat.extra') }}</span>
                  }
                </span>
                <span class="mat-fig" aria-live="polite">
                  <b>{{ i18n.number(m.used) }}</b>
                  @if (m.planned !== null) {
                    / {{ i18n.number(m.planned) }}
                  }
                  {{ m.unit ?? '' }}
                </span>
              </div>
              @if (m.planned !== null && m.planned > 0) {
                <div class="w-bar mt-1.5" [class.is-over]="m.used > m.planned" aria-hidden="true"><span [style.width.%]="share(m)"></span></div>
                @if (m.used > m.planned) {
                  <p class="mat-over">{{ i18n.t('mat.over', { q: i18n.number(round(m.used - m.planned)), unit: m.unit ?? '' }) }}</p>
                }
              }
              @if (editable()) {
                <div class="mat-steps mt-2" role="group" [attr.aria-label]="i18n.t('mat.addAria', { name: m.name })">
                  @for (s of steps(m); track s) {
                    <button type="button" class="w-btn w-btn-soft" [disabled]="busy()" [attr.aria-label]="i18n.t('mat.stepAria', { q: i18n.number(s), unit: m.unit ?? '', name: m.name })" (click)="add(m, s)">+{{ i18n.number(s) }}</button>
                  }
                  <button type="button" class="w-btn w-btn-line" [attr.aria-expanded]="openKey() === m.key" (click)="toggle(m)">{{ i18n.t('mat.other') }}</button>
                </div>
                @if (openKey() === m.key) {
                  <form class="mat-panel mt-2" novalidate (ngSubmit)="submit(m)">
                    @if (m.used > 0) {
                      <div class="w-seg" role="group">
                        <button type="button" [attr.aria-pressed]="!fixing()" (click)="fixing.set(false)">{{ i18n.t('mat.modeAdd') }}</button>
                        <button type="button" [attr.aria-pressed]="fixing()" (click)="fixing.set(true)">{{ i18n.t('mat.modeFix') }}</button>
                      </div>
                    }
                    <label class="block">
                      <span class="w-label">{{ i18n.t(fixing() ? 'mat.fixAmount' : 'mat.amount') }}@if (m.unit) { ({{ m.unit }})}</span>
                      <input name="amount" type="text" inputmode="decimal" autocomplete="off" class="w-field" [ngModel]="amount()" (ngModelChange)="amount.set($event)" />
                    </label>
                    @if (fixing()) {
                      <label class="block">
                        <span class="w-label">{{ i18n.t('order.fixReason') }}</span>
                        <input name="reason" type="text" maxlength="500" class="w-field" [placeholder]="i18n.t('order.fixReasonPlaceholder')" [ngModel]="reason()" (ngModelChange)="reason.set($event)" />
                      </label>
                    }
                    <div class="w-pair">
                      <button type="button" class="w-btn w-btn-line" (click)="closePanel()">{{ i18n.t('common.cancel') }}</button>
                      <button type="submit" class="w-btn w-btn-dark" [disabled]="busy()">{{ i18n.t('common.save') }}</button>
                    </div>
                  </form>
                }
              }
            </li>
          }
        </ul>
      } @else if (editable()) {
        <p class="w-small w-muted mt-2">{{ i18n.t('mat.none') }}</p>
      } @else {
        <p class="w-small w-muted mt-2">{{ i18n.t('op.noMaterial') }}</p>
      }

      @if (editable()) {
        @if (addingOther()) {
          <form class="mat-panel mt-3" novalidate (ngSubmit)="submitOther()">
            <label class="block">
              <span class="w-label">{{ i18n.t('form.materialName') }}</span>
              <input name="otherName" type="text" maxlength="80" class="w-field" [placeholder]="i18n.t('form.materialPlaceholder')" [ngModel]="otherName()" (ngModelChange)="otherName.set($event)" />
            </label>
            <div class="w-pair">
              <label class="block">
                <span class="w-label">{{ i18n.t('mat.amount') }}</span>
                <input name="otherAmount" type="text" inputmode="decimal" autocomplete="off" class="w-field" [ngModel]="otherAmount()" (ngModelChange)="otherAmount.set($event)" />
              </label>
              <label class="block">
                <span class="w-label">{{ i18n.t('form.materialUnit') }}</span>
                <select name="otherUnit" class="w-field" [ngModel]="otherUnit()" (ngModelChange)="otherUnit.set($event)">
                  @for (u of units; track u) {
                    <option [value]="u">{{ u }}</option>
                  }
                </select>
              </label>
            </div>
            <div class="w-pair">
              <button type="button" class="w-btn w-btn-line" (click)="addingOther.set(false)">{{ i18n.t('common.cancel') }}</button>
              <button type="submit" class="w-btn w-btn-dark" [disabled]="busy()">{{ i18n.t('common.save') }}</button>
            </div>
          </form>
        } @else {
          <button type="button" class="w-btn w-btn-line mt-3" (click)="addingOther.set(true)"><aon-icon name="plus" [size]="17" [stroke]="2.25" />{{ i18n.t('mat.addOther') }}</button>
        }
      }
    </section>
  `,
  styles: `
    .mat {
      padding: 0.7rem 0;
    }
    .mat:first-child {
      padding-top: 0.2rem;
    }
    .mat:last-child {
      padding-bottom: 0.2rem;
    }
    .mat-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .mat-name {
      min-width: 0;
      font-weight: 600;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .mat-extra {
      display: inline-block;
      margin-left: 0.25rem;
      padding: 0 0.45rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text-muted);
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
    }
    .mat-fig {
      flex: 0 0 auto;
      color: var(--color-text-muted);
      font-size: 0.93rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .mat-fig b {
      color: var(--color-text);
      font-size: 1.05rem;
      font-weight: 650;
    }
    .w-bar.is-over > span {
      background: var(--color-bad);
    }
    .mat-over {
      margin-top: 0.25rem;
      color: var(--color-bad-ink);
      font-size: 0.85rem;
    }
    .mat-steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.25fr);
      gap: 0.4rem;
    }
    .mat-steps .w-btn {
      padding-inline: 0.25rem;
    }
    .mat-panel {
      display: grid;
      gap: 0.6rem;
      padding: 0.7rem;
      border-radius: 0.6rem;
      background: var(--color-row-tint);
      box-shadow: inset 0 0 0 1px var(--color-line);
    }
    select.w-field {
      padding-inline: 0.5rem;
    }
  `,
})
export class OrderMaterialsComponent {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(WorkerStore);
  private readonly toast = inject(ToastService);

  readonly order = input.required<LocalWorkOrder>();
  /** The order is running on this phone: usage can be logged. */
  readonly canLog = input(false);
  /** Not started yet: the list is read-only and says why. */
  readonly waiting = input(false);

  protected readonly units = EXTRA_UNITS;
  protected readonly busy = signal(false);
  protected readonly openKey = signal<string | null>(null);
  protected readonly fixing = signal(false);
  protected readonly amount = signal('');
  protected readonly reason = signal('');
  protected readonly addingOther = signal(false);
  protected readonly otherName = signal('');
  protected readonly otherAmount = signal('');
  protected readonly otherUnit = signal<string>('kos');

  protected readonly lines = computed(() => materialLines(this.order()));
  protected readonly editable = this.canLog;

  /** Bulk goods move in halves, everything else in whole pieces. */
  protected steps(m: MaterialLine): readonly number[] {
    return m.unit === 't' || m.unit === 'm³' || m.unit === 'm3' ? [0.5, 1, 2] : [1, 5, 10];
  }

  protected share(m: MaterialLine): number {
    return m.planned ? Math.min(100, (m.used / m.planned) * 100) : 0;
  }

  protected round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  protected toggle(m: MaterialLine): void {
    const opening = this.openKey() !== m.key;
    this.closePanel();
    if (opening) this.openKey.set(m.key);
  }

  protected closePanel(): void {
    this.openKey.set(null);
    this.fixing.set(false);
    this.amount.set('');
    this.reason.set('');
  }

  protected add(m: MaterialLine, q: number): Promise<void> {
    // The figure on the line changes under the thumb; a toast would only cover the next line.
    return this.run(() => this.store.addMaterial(this.order().id, m.name, m.unit, q));
  }

  protected submit(m: MaterialLine): Promise<void> {
    const q = parseAmount(this.amount());
    if (this.fixing()) {
      if (!Number.isFinite(q) || q <= 0 || q > m.used) {
        this.toast.error(this.i18n.t('mat.fixInvalid', { used: this.i18n.number(m.used), unit: m.unit ?? '' }));
        return Promise.resolve();
      }
      if (!this.reason().trim()) {
        this.toast.error(this.i18n.t('order.fixNeedReason'));
        return Promise.resolve();
      }
      return this.run(async () => {
        await this.store.correctMaterial(this.order().id, m.name, m.unit, q, this.reason());
        this.toast.success(this.i18n.t('mat.fixed', { q: this.i18n.number(q), unit: m.unit ?? '', name: m.name }));
        this.closePanel();
      });
    }
    if (!Number.isFinite(q) || q <= 0) {
      this.toast.error(this.i18n.t('order.quantityInvalid'));
      return Promise.resolve();
    }
    return this.add(m, q).then(() => this.closePanel());
  }

  protected submitOther(): Promise<void> {
    const name = this.otherName().trim();
    const q = parseAmount(this.otherAmount());
    if (!name) {
      this.toast.error(this.i18n.t('mat.needName'));
      return Promise.resolve();
    }
    if (!Number.isFinite(q) || q <= 0) {
      this.toast.error(this.i18n.t('order.quantityInvalid'));
      return Promise.resolve();
    }
    // The same name as a line on the order counts towards that line, with its unit.
    const known = this.lines().find((l) => l.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const unit = known ? known.unit : this.otherUnit();
    return this.run(async () => {
      await this.store.addMaterial(this.order().id, known?.name ?? name, unit, q);
      this.otherName.set('');
      this.otherAmount.set('');
      this.addingOther.set(false);
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await work();
    } catch (err: unknown) {
      this.toast.error(workflowMessage(this.i18n, err));
    } finally {
      this.busy.set(false);
    }
  }
}
