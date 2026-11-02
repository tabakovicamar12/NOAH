import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component';

/** Firefox and desktop Safari have no month picker; there the month is stepped with the arrows only. */
const MONTH_PICKER = ((): boolean => {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('input');
  probe.type = 'month';
  return probe.type === 'month';
})();

/**
 * The one day or month control of the app: previous, the period as a calendar button, next. The whole middle
 * opens the device's own calendar, so it works the same on a phone, a tablet and at the desk.
 */
@Component({
  selector: 'aon-period-nav',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pn" role="group" [attr.aria-label]="groupLabel()">
      <button type="button" class="pn-step" [attr.aria-label]="prevLabel()" (click)="stepped.emit(-1)"><aon-icon name="chevron-left" [size]="20" [stroke]="2" /></button>
      @if (kind() === 'day' || monthPicker) {
        <label class="pn-mid is-pick">
          <aon-icon name="calendar" [size]="17" [stroke]="1.8" />
          <span class="pn-text" [class.is-month]="kind() === 'month'">{{ label() }}</span>
          <span class="sr-only">{{ pickLabel() }}</span>
          <input [type]="kind() === 'day' ? 'date' : 'month'" [value]="value()" [max]="max()" (click)="openCalendar($event)" (change)="onPick($event)" />
        </label>
      } @else {
        <span class="pn-mid"><span class="pn-text is-month">{{ label() }}</span></span>
      }
      <button type="button" class="pn-step" [disabled]="!canNext()" [attr.aria-label]="nextLabel()" (click)="stepped.emit(1)"><aon-icon name="chevron-right" [size]="20" [stroke]="2" /></button>
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
      max-width: 100%;
      min-width: 0;
    }
    .pn {
      display: flex;
      width: 100%;
      min-width: 0;
      align-items: stretch;
      overflow: hidden;
      border-radius: 0.5rem;
      background: var(--color-panel);
      box-shadow: inset 0 0 0 1px var(--color-line-strong), 0 1px 2px rgb(20 20 20 / 0.04);
    }
    .pn-step {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: var(--m-tap);
      height: var(--m-tap);
      color: var(--color-text);
      transition: background-color 150ms var(--ease-out-expo);
    }
    .pn-step:hover:not(:disabled) {
      background: var(--color-field);
    }
    .pn-step:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .pn-step:focus-visible,
    .is-pick:focus-within {
      outline: 2px solid var(--color-charcoal);
      outline-offset: -2px;
      box-shadow: none;
    }
    .pn-mid {
      position: relative;
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      padding: 0 0.6rem;
      border-inline: 1px solid var(--color-line);
      color: var(--color-text);
      font-weight: 600;
      white-space: nowrap;
    }
    .is-pick {
      cursor: pointer;
      transition: background-color 150ms var(--ease-out-expo);
    }
    .is-pick:hover {
      background: var(--color-field);
    }
    .is-pick aon-icon {
      flex: 0 0 auto;
      color: var(--color-text-muted);
    }
    .pn-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pn-text.is-month::first-letter {
      text-transform: uppercase;
    }
    .pn-mid input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    @media (max-width: 700px) {
      :host {
        display: flex;
        width: 100%;
      }
    }
  `,
})
export class PeriodNavComponent {
  readonly kind = input<'day' | 'month'>('day');
  /** `YYYY-MM-DD` or `YYYY-MM`, for the calendar. */
  readonly value = input.required<string>();
  readonly max = input.required<string>();
  readonly label = input.required<string>();
  readonly groupLabel = input.required<string>();
  readonly prevLabel = input.required<string>();
  readonly nextLabel = input.required<string>();
  readonly pickLabel = input.required<string>();
  readonly canNext = input(true);
  readonly stepped = output<-1 | 1>();
  readonly picked = output<string>();

  protected readonly monthPicker = MONTH_PICKER;

  /** The whole button opens the calendar, not only the browser's small icon inside the hidden field. */
  protected openCalendar(event: Event): void {
    const field = event.target as HTMLInputElement & { showPicker?: () => void };
    try {
      field.showPicker?.();
    } catch {
      // Older browsers open it themselves, or not at all; the arrows still work.
    }
  }

  protected onPick(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.picked.emit(value);
  }
}
