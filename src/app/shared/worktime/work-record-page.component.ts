import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { HoursResponse } from '../../core/models/api.models';
import { HoursData, type HoursSide } from '../../core/worktime/hours-data.service';
import { isMonth, shiftMonth } from '../../core/worktime/worktime';
import { toIsoDate } from '../../core/util/util';
import { IconComponent } from '../ui/icon.component';
import { WorkRecordComponent } from './work-record.component';

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: HoursResponse; readonly cachedAt: number | null };

/**
 * The monthly record page: a toolbar (back, month, export) above the A4 sheet. The desk opens any worker in its
 * scope (`/m/hours/:userId`); a worker opens their own (`/w/hours`), which is their electronic access to the
 * record under ZEPDSV.
 */
@Component({
  selector: 'aon-work-record-page',
  imports: [RouterLink, IconComponent, WorkRecordComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar no-print">
      <div class="bar-l">
        <a [routerLink]="backLink()" [queryParams]="side() === 'manager' ? { month: month() } : null" class="back" [attr.aria-label]="i18n.t('common.back')">
          <aon-icon name="arrow-left" [size]="20" [stroke]="2.2" />
        </a>
        <div class="min-w-0">
          <h1 class="bar-title">{{ side() === 'worker' ? i18n.t('hours.mineTitle') : (workerName() || i18n.t('rec.title')) }}</h1>
          <p class="bar-sub">{{ side() === 'worker' ? i18n.t('hours.mineHint') : i18n.t('pdf.hint') }}</p>
        </div>
      </div>
      <div class="bar-r">
        <div class="month" role="group" [attr.aria-label]="monthLabel()">
          <button type="button" class="mbtn" [attr.aria-label]="i18n.t('hours.prevMonth')" (click)="go(-1)"><aon-icon name="chevron-left" [size]="18" /></button>
          <span class="mlabel">{{ monthLabel() }}</span>
          <button type="button" class="mbtn" [disabled]="isCurrent()" [attr.aria-label]="i18n.t('hours.nextMonth')" (click)="go(1)"><aon-icon name="chevron-right" [size]="18" /></button>
        </div>
        <button type="button" class="print" [disabled]="state().kind !== 'READY' || !hasWorker()" (click)="print()">
          <aon-icon name="printer" [size]="18" />{{ i18n.t('pdf.print') }}
        </button>
      </div>
    </div>

    <div class="stage">
      @switch (state().kind) {
        @case ('LOADING') {
          <div class="paper skel" aria-busy="true"><span class="sr-only">{{ i18n.t('common.loading') }}</span></div>
        }
        @case ('ERROR') {
          <p class="banner bad no-print" role="alert">
            <aon-icon name="alert" [size]="18" />{{ i18n.t('hours.loadFailed') }}
            <button type="button" class="banner-btn" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </p>
        }
        @case ('READY') {
          @if (cachedAt(); as at) {
            <p class="banner no-print" role="status"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('hours.offline', { time: i18n.time(at) }) }}</p>
          }
          @if (ready(); as d) {
            @if (hasWorker()) {
              <div class="paper">
                <aon-work-record [data]="d" [userId]="uid()" [now]="now()" />
              </div>
            } @else {
              <p class="banner no-print">{{ i18n.t('rec.empty') }}</p>
            }
          }
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .bar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem 1.25rem;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid var(--color-line);
      background: color-mix(in srgb, var(--color-site) 92%, transparent);
      backdrop-filter: blur(8px);
    }
    .bar-l {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }
    .back {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.6rem;
      background: var(--color-panel);
      color: var(--color-text);
    }
    .bar-title {
      font-size: 1.15rem;
      font-weight: 650;
      line-height: 1.2;
    }
    .bar-sub {
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .bar-r {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem;
    }
    .month {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.2rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.6rem;
      background: var(--color-panel);
    }
    .mbtn {
      display: grid;
      place-items: center;
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 0.45rem;
    }
    .mbtn:hover:not(:disabled) {
      background: var(--color-field);
    }
    .mbtn:disabled {
      opacity: 0.35;
    }
    .mlabel {
      min-width: 8.5rem;
      font-weight: 600;
      text-align: center;
      text-transform: capitalize;
    }
    .print {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.9rem;
      padding: 0 1.1rem;
      border-radius: 0.6rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 650;
    }
    .print:disabled {
      opacity: 0.5;
    }
    .stage {
      padding: 1.5rem 1rem 3rem;
    }
    .paper {
      max-width: 210mm;
      margin: 0 auto;
      padding: 14mm 13mm;
      background: #fff;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.06), 0 22px 48px -26px rgb(20 20 20 / 0.45);
    }
    .skel {
      height: 70vh;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      max-width: 210mm;
      margin: 0 auto 1rem;
      padding: 0.7rem 0.9rem;
      border-radius: 0.6rem;
      background: var(--color-gold-tint);
    }
    .banner.bad {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .banner-btn {
      margin-left: auto;
      font-weight: 600;
      text-decoration: underline;
    }
    @media (max-width: 700px) {
      .bar {
        padding: 0.6rem 0.9rem;
      }
      .bar-sub {
        display: none;
      }
      .bar-r {
        width: 100%;
        justify-content: space-between;
      }
      .stage {
        padding: 0.75rem 0.5rem 2rem;
      }
      .paper {
        padding: 1rem 0.9rem 1.25rem;
      }
    }
    @media print {
      .stage {
        padding: 0;
      }
      .paper {
        max-width: none;
        padding: 0;
        box-shadow: none;
      }
    }
  `,
})
export class WorkRecordPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly hours = inject(HoursData);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  /** Route data: which API the page reads. */
  readonly side = input<HoursSide>('manager');
  /** Route param on the desk; the worker reads their own record. */
  readonly userId = input<string | undefined>(undefined);
  readonly monthParam = input<string | undefined>(undefined, { alias: 'month' });

  private readonly thisMonth = toIsoDate().slice(0, 7);
  protected readonly month = computed(() => {
    const m = this.monthParam();
    return m && isMonth(m) && m <= this.thisMonth ? m : this.thisMonth;
  });
  protected readonly isCurrent = computed(() => this.month() >= this.thisMonth);
  protected readonly uid = computed(() => (this.side() === 'worker' ? (this.session.user()?.id ?? '') : (this.userId() ?? '')));
  protected readonly backLink = computed(() => (this.side() === 'worker' ? '/w/more' : '/m/hours'));
  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly now = signal(Date.now());

  protected readonly ready = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });
  protected readonly cachedAt = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.cachedAt : null;
  });
  protected readonly hasWorker = computed(() => !!this.ready()?.workers.some((w) => w.id === this.uid()));
  protected readonly workerName = computed(() => this.ready()?.workers.find((w) => w.id === this.uid())?.displayName ?? '');
  protected readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Intl.DateTimeFormat(this.i18n.locale(), { month: 'long', year: 'numeric' }).format(new Date(y ?? 1970, (m ?? 1) - 1, 1));
  });

  constructor() {
    effect(() => {
      this.month();
      this.side();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    const month = this.month();
    const side = this.side();
    const hit = this.hours.cached(side, month);
    this.state.set(hit ? { kind: 'READY', data: hit.data, cachedAt: null } : { kind: 'LOADING' });
    try {
      const res = await this.hours.load(side, month);
      if (month !== this.month()) return;
      this.now.set(Math.max(res.data.serverTime, Date.now()));
      this.state.set({ kind: 'READY', data: res.data, cachedAt: res.cachedAt });
    } catch {
      if (month === this.month()) this.state.set({ kind: 'ERROR' });
    }
  }

  protected go(step: number): void {
    const next = shiftMonth(this.month(), step);
    void this.router.navigate([], { queryParams: { month: next === this.thisMonth ? null : next }, replaceUrl: true });
  }

  protected print(): void {
    this.now.set(Date.now());
    this.document.defaultView?.print();
  }
}
