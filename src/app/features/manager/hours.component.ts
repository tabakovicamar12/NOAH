import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { HoursResponse } from '../../core/models/api.models';
import type { User } from '../../core/models/domain.models';
import { HoursData } from '../../core/worktime/hours-data.service';
import { WORKTIME_RULES, analyzeMonth, hm, isMonth, shiftMonth, type WorkIssue, type WorkMonth } from '../../core/worktime/worktime';
import { toIsoDate } from '../../core/util/util';
import { IconComponent } from '../../shared/ui/icon.component';
import { avatarTone, initialsOf } from './person';

interface Row {
  readonly user: User;
  readonly m: WorkMonth;
  /** Distinct findings, worst first, for the chips. */
  readonly chips: readonly WorkIssue[];
}

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: HoursResponse; readonly cachedAt: number | null };

const RANK = { over: 0, near: 1, note: 2, ok: 3 } as const;

/**
 * Delovni čas: every worker in scope for one month, with hours, overtime against the ZDR-1 caps and whatever
 * needs a look. Each row opens the worker's monthly record, which prints as the signed A4 evidence.
 */
@Component({
  selector: 'aon-manager-hours',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <div>
          <h1 class="title">{{ i18n.t('hours.title') }}</h1>
          <p class="sub">{{ i18n.t('hours.subtitle') }}</p>
        </div>
        <div class="month" role="group" [attr.aria-label]="monthLabel()">
          <button type="button" class="mbtn" [attr.aria-label]="i18n.t('hours.prevMonth')" (click)="go(-1)"><aon-icon name="chevron-left" [size]="18" /></button>
          <span class="mlabel">{{ monthLabel() }}</span>
          <button type="button" class="mbtn" [disabled]="isCurrent()" [attr.aria-label]="i18n.t('hours.nextMonth')" (click)="go(1)"><aon-icon name="chevron-right" [size]="18" /></button>
        </div>
      </header>

      @switch (state().kind) {
        @case ('LOADING') {
          <div class="card skel" aria-busy="true"><span class="sr-only">{{ i18n.t('common.loading') }}</span></div>
        }
        @case ('ERROR') {
          <p class="banner bad" role="alert">
            <aon-icon name="alert" [size]="18" />{{ i18n.t('hours.loadFailed') }}
            <button type="button" class="banner-btn" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </p>
        }
        @case ('READY') {
          @if (cachedAt(); as at) {
            <p class="banner" role="status"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('hours.offline', { time: i18n.time(at) }) }}</p>
          }
          <section class="kpis" [attr.aria-label]="i18n.t('hours.title')">
            <div class="kpi">
              <p class="kpi-k">{{ i18n.t('hours.kpiHours') }}</p>
              <p class="kpi-v">{{ hm(totals().minutes) }}<span class="kpi-u">h</span></p>
              <p class="kpi-s">{{ i18n.t('hours.kpiWorkers') }}: {{ totals().active }}</p>
            </div>
            <div class="kpi">
              <p class="kpi-k">{{ i18n.t('hours.kpiOvertime') }}</p>
              <p class="kpi-v">{{ hm(totals().overtime) }}<span class="kpi-u">h</span></p>
              <p class="kpi-s">{{ i18n.t('rec.ofLimit', { limit: R.overtimeMonthMin / 60 }) }} / {{ i18n.t('hours.colWorker').toLowerCase() }}</p>
            </div>
            <div class="kpi" [class.is-bad]="totals().over > 0">
              <p class="kpi-k">{{ i18n.t('hours.kpiFlagged') }}</p>
              <p class="kpi-v">{{ totals().over }}</p>
              <p class="kpi-s">{{ i18n.t('hours.over') }}</p>
            </div>
            <div class="kpi" [class.is-warn]="totals().near > 0">
              <p class="kpi-k">{{ i18n.t('hours.kpiNear') }}</p>
              <p class="kpi-v">{{ totals().near }}</p>
              <p class="kpi-s">≥ {{ R.warnShare * 100 }} %</p>
            </div>
          </section>

          <label class="search">
            <span class="sr-only">{{ i18n.t('hours.search') }}</span>
            <aon-icon name="search" [size]="18" [stroke]="1.8" />
            <input type="search" autocomplete="off" [placeholder]="i18n.t('hours.search')" [value]="query()" (input)="query.set($any($event.target).value)" />
          </label>

          <div class="card">
            <table class="tbl">
              <thead>
                <tr>
                  <th scope="col">{{ i18n.t('hours.colWorker') }}</th>
                  <th scope="col" class="r">{{ i18n.t('hours.colDays') }}</th>
                  <th scope="col" class="r">{{ i18n.t('hours.colHours') }}</th>
                  <th scope="col">{{ i18n.t('hours.colOtMonth') }}</th>
                  <th scope="col">{{ i18n.t('hours.colOtYear') }}</th>
                  <th scope="col" class="r">{{ i18n.t('hours.colLongest') }}</th>
                  <th scope="col">{{ i18n.t('hours.colFindings') }}</th>
                  <th scope="col"><span class="sr-only">{{ i18n.t('hours.record') }}</span></th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.user.id) {
                  <tr class="row" [attr.data-level]="r.m.level" (click)="open(r.user.id)">
                    <td class="c-who">
                      <span class="who">
                        <span class="ava" [attr.data-tone]="tone(r.user.displayName)" aria-hidden="true">{{ initials(r.user.displayName) }}</span>
                        <span class="min-w-0">
                          <a class="name" [routerLink]="['/m/hours', r.user.id]" [queryParams]="{ month: month() }" [attr.aria-label]="i18n.t('hours.openRecord', { name: r.user.displayName })" (click)="$event.stopPropagation()">{{ r.user.displayName }}</a>
                          <span class="crew">{{ r.user.crew || '—' }}</span>
                        </span>
                      </span>
                    </td>
                    <td class="r num c-days" [attr.data-label]="i18n.t('hours.colDays')">{{ r.m.days.length }}</td>
                    <td class="r num strong c-hours" [attr.data-label]="i18n.t('hours.colHours')">{{ hm(r.m.minutes) }}</td>
                    <td class="c-ot" [attr.data-label]="i18n.t('hours.colOtMonth')">
                      <span class="gauge" [attr.data-level]="levelOf(r.m.overtime, R.overtimeMonthMin)">
                        <span class="num">{{ hm(r.m.overtime) }}<span class="of"> / {{ R.overtimeMonthMin / 60 }}</span></span>
                        <span class="bar" aria-hidden="true"><span [style.width.%]="share(r.m.overtime, R.overtimeMonthMin)"></span></span>
                      </span>
                    </td>
                    <td class="c-ot" [attr.data-label]="i18n.t('hours.colOtYear')">
                      <span class="gauge" [attr.data-level]="levelOf(r.m.overtimeYear, R.overtimeYearMin)">
                        <span class="num">{{ hm(r.m.overtimeYear) }}<span class="of"> / {{ R.overtimeYearMin / 60 }}</span></span>
                        <span class="bar" aria-hidden="true"><span [style.width.%]="share(r.m.overtimeYear, R.overtimeYearMin)"></span></span>
                      </span>
                    </td>
                    <td class="r num c-long" [class.bad]="r.m.longestDay > R.maxDayMin" [attr.data-label]="i18n.t('hours.colLongest')">{{ r.m.longestDay ? hm(r.m.longestDay) : '–' }}</td>
                    <td class="c-find">
                      @if (r.chips.length) {
                        <span class="chips">
                          @for (c of r.chips.slice(0, 2); track c.kind) {
                            <span class="chip" [attr.data-level]="c.level" [title]="issueText(c)">{{ i18n.t(shortKey(c)) }}</span>
                          }
                          @if (r.chips.length > 2) {
                            <span class="chip more">+{{ r.chips.length - 2 }}</span>
                          }
                        </span>
                      } @else {
                        <span class="okay"><aon-icon name="check" [size]="14" [stroke]="2.4" />{{ i18n.t('hours.ok') }}</span>
                      }
                    </td>
                    <td class="c-go" aria-hidden="true"><aon-icon name="chevron-right" [size]="18" /></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="empty">{{ query() ? i18n.t('hours.noMatch') : i18n.t('hours.empty') }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="legal"><aon-icon name="shield" [size]="14" />{{ i18n.t('hours.legal') }}</p>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .page {
      max-width: 82rem;
      padding: 1.4rem 2rem 3rem;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem 1.5rem;
    }
    .title {
      font-size: clamp(1.6rem, 1.3rem + 1.2vw, 2.09rem);
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .sub {
      margin-top: 0.15rem;
      color: var(--color-text-muted);
    }
    .month {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.6rem;
      background: var(--color-panel);
    }
    .mbtn {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 0.45rem;
      color: var(--color-text);
    }
    .mbtn:hover:not(:disabled) {
      background: var(--color-field);
    }
    .mbtn:disabled {
      opacity: 0.35;
    }
    .mlabel {
      min-width: 9.5rem;
      font-weight: 600;
      text-align: center;
      text-transform: capitalize;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 1.25rem;
      overflow: hidden;
      border-radius: 0.85rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 8px 22px -16px rgb(20 20 20 / 0.3);
    }
    .kpi {
      padding: 0.9rem 1.1rem 1rem;
    }
    .kpi + .kpi {
      border-left: 1px solid var(--color-line);
    }
    .kpi-k {
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .kpi-v {
      margin-top: 0.2rem;
      font-size: 1.85rem;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .kpi-u {
      margin-left: 0.2rem;
      color: var(--color-text-muted);
      font-size: 0.95rem;
      font-weight: 500;
    }
    .kpi-s {
      margin-top: 0.2rem;
      color: var(--color-text-muted);
      font-size: 0.8rem;
    }
    .kpi.is-bad .kpi-v,
    .kpi.is-bad .kpi-k {
      color: var(--color-bad);
    }
    .kpi.is-warn .kpi-v {
      color: #9a6a0c;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      max-width: 26rem;
      height: 2.75rem;
      margin-top: 1rem;
      padding: 0 0.85rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.6rem;
      background: var(--color-panel);
      color: var(--color-text-muted);
    }
    .search:focus-within {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.18);
    }
    .search input {
      flex: 1 1 auto;
      min-width: 0;
      height: 100%;
      background: transparent;
      color: var(--color-text);
      outline: none;
    }
    .card {
      margin-top: 0.85rem;
      overflow: hidden;
      border-radius: 0.85rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.05), 0 8px 22px -16px rgb(20 20 20 / 0.3);
    }
    .skel {
      height: 22rem;
      margin-top: 1.25rem;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
    }
    .tbl th,
    .tbl td {
      padding: 0.8rem 0.9rem;
      text-align: left;
      vertical-align: middle;
    }
    .tbl thead th {
      border-bottom: 1px solid var(--color-line);
      color: var(--color-text-muted);
      font-size: 0.85rem;
      font-weight: 500;
      white-space: nowrap;
    }
    .tbl .r {
      text-align: right;
    }
    .row {
      cursor: pointer;
      border-bottom: 1px solid var(--color-line);
      transition: background-color 140ms var(--ease-out-expo);
    }
    .row:last-child {
      border-bottom: 0;
    }
    .row:hover {
      background: var(--color-row-tint);
    }
    .row[data-level='over'] .c-who {
      box-shadow: inset 3px 0 0 var(--color-bad);
    }
    .row[data-level='near'] .c-who {
      box-shadow: inset 3px 0 0 #d39b25;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .strong {
      font-weight: 600;
    }
    .bad {
      color: var(--color-bad);
      font-weight: 650;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 0.7rem;
    }
    .ava {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: 2.1rem;
      height: 2.1rem;
      border-radius: 9999px;
      background: #4f7a6b;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .ava[data-tone='1'] {
      background: #5a6b8f;
    }
    .ava[data-tone='2'] {
      background: #8a6a4a;
    }
    .ava[data-tone='3'] {
      background: #6f5f86;
    }
    .ava[data-tone='4'] {
      background: #7d7a4e;
    }
    .name {
      display: block;
      color: var(--color-text);
      font-weight: 600;
      text-decoration: none;
    }
    .name:hover {
      text-decoration: underline;
    }
    .crew {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .gauge {
      display: grid;
      gap: 0.3rem;
      min-width: 7rem;
    }
    .of {
      color: var(--color-text-muted);
      font-size: 0.85em;
    }
    .bar {
      display: block;
      height: 5px;
      border-radius: 3px;
      background: var(--color-track);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-progress);
    }
    .gauge[data-level='near'] .bar > span {
      background: #d39b25;
    }
    .gauge[data-level='over'] .bar > span {
      background: var(--color-bad);
    }
    .gauge[data-level='over'] .num {
      color: var(--color-bad);
      font-weight: 650;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
    }
    .chip {
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      background: var(--color-new-tint);
      color: var(--color-new-ink);
      font-size: 0.8rem;
      font-weight: 550;
      white-space: nowrap;
    }
    .chip[data-level='over'] {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .chip[data-level='near'] {
      background: #fbefd2;
      color: #7a530a;
    }
    .okay {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--color-ok);
      font-size: 0.88rem;
      font-weight: 550;
    }
    .c-go {
      width: 2rem;
      color: var(--color-text-muted);
    }
    .empty {
      padding: 2.5rem 1rem !important;
      color: var(--color-text-muted);
      text-align: center !important;
    }
    .legal {
      display: flex;
      align-items: flex-start;
      gap: 0.45rem;
      max-width: 52rem;
      margin-top: 0.85rem;
      color: var(--color-text-muted);
      font-size: 0.82rem;
    }
    .legal aon-icon {
      margin-top: 0.15rem;
    }
    .banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1.25rem;
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
    @media (max-width: 1100px) {
      .c-long,
      .tbl thead th:nth-child(6) {
        display: none;
      }
    }
    @media (max-width: 900px) {
      .page {
        padding: 0.9rem 0.9rem 2rem;
      }
      .head {
        align-items: flex-start;
      }
      .kpis {
        grid-template-columns: 1fr 1fr;
      }
      .kpi:nth-child(3) {
        border-left: 0;
      }
      .kpi:nth-child(n + 3) {
        border-top: 1px solid var(--color-line);
      }
      .search {
        max-width: none;
      }
    }
    /* Phones: each worker is a card; overtime gauges sit side by side. */
    @media (max-width: 700px) {
      .tbl thead {
        display: none;
      }
      .tbl tbody,
      .tbl tr {
        display: block;
      }
      .tbl tr.row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6rem 0.9rem;
        padding: 0.9rem;
      }
      .row td {
        display: block;
        padding: 0 !important;
      }
      .c-who {
        grid-column: 1 / -1;
      }
      .row[data-level='over'] .c-who,
      .row[data-level='near'] .c-who {
        box-shadow: none;
      }
      .row[data-level='over'] {
        box-shadow: inset 3px 0 0 var(--color-bad);
      }
      .row[data-level='near'] {
        box-shadow: inset 3px 0 0 #d39b25;
      }
      .c-days,
      .c-hours {
        text-align: left !important;
        font-size: 1.05rem;
      }
      .c-days::before,
      .c-hours::before,
      .c-ot::before {
        content: attr(data-label);
        color: var(--color-text-muted);
        font-size: 0.8rem;
        font-weight: 400;
      }
      .c-days::before,
      .c-hours::before,
      .c-ot::before {
        display: block;
        margin-bottom: 0.2rem;
      }
      .c-find {
        grid-column: 1 / -1;
      }
      .c-go,
      .c-long {
        display: none !important;
      }
    }
  `,
})
export class HoursComponent {
  protected readonly i18n = inject(I18nService);
  private readonly hours = inject(HoursData);
  private readonly router = inject(Router);
  protected readonly R = WORKTIME_RULES;
  protected readonly hm = hm;

  /** `?month=YYYY-MM`, bound by withComponentInputBinding. */
  readonly monthParam = input<string | undefined>(undefined, { alias: 'month' });

  private readonly thisMonth = toIsoDate().slice(0, 7);
  protected readonly month = computed(() => {
    const m = this.monthParam();
    return m && isMonth(m) && m <= this.thisMonth ? m : this.thisMonth;
  });
  protected readonly isCurrent = computed(() => this.month() >= this.thisMonth);
  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly query = signal('');
  protected readonly cachedAt = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.cachedAt : null;
  });

  protected readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Intl.DateTimeFormat(this.i18n.locale(), { month: 'long', year: 'numeric' }).format(new Date(y ?? 1970, (m ?? 1) - 1, 1));
  });

  private readonly analyzed = computed<Row[]>(() => {
    const s = this.state();
    if (s.kind !== 'READY') return [];
    const now = Math.max(s.data.serverTime, Date.now());
    return s.data.workers.map((user) => {
      const m = analyzeMonth(
        s.data.shifts.filter((e) => e.userId === user.id),
        s.data.month,
        now,
      );
      const seen = new Set<string>();
      const chips = [...m.issues]
        .sort((a, b) => RANK[a.level] - RANK[b.level])
        .filter((i) => (seen.has(i.kind) ? false : (seen.add(i.kind), true)));
      return { user, m, chips };
    });
  });

  protected readonly rows = computed<Row[]>(() => {
    const q = this.query().trim().toLocaleLowerCase();
    return this.analyzed()
      .filter((r) => !q || r.user.displayName.toLocaleLowerCase().includes(q) || (r.user.crew ?? '').toLocaleLowerCase().includes(q))
      .sort((a, b) => RANK[a.m.level] - RANK[b.m.level] || b.m.minutes - a.m.minutes || a.user.displayName.localeCompare(b.user.displayName));
  });

  protected readonly totals = computed(() => {
    const rows = this.analyzed();
    return {
      minutes: rows.reduce((s, r) => s + r.m.minutes, 0),
      overtime: rows.reduce((s, r) => s + r.m.overtime, 0),
      active: rows.filter((r) => r.m.days.length > 0).length,
      over: rows.filter((r) => r.m.level === 'over').length,
      near: rows.filter((r) => r.m.level === 'near').length,
    };
  });

  constructor() {
    effect(() => {
      this.month();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    const month = this.month();
    const hit = this.hours.cached('manager', month);
    this.state.set(hit ? { kind: 'READY', data: hit.data, cachedAt: null } : { kind: 'LOADING' });
    try {
      const res = await this.hours.load('manager', month);
      if (month === this.month()) this.state.set({ kind: 'READY', data: res.data, cachedAt: res.cachedAt });
    } catch {
      if (month === this.month()) this.state.set({ kind: 'ERROR' });
    }
  }

  protected go(step: number): void {
    const next = shiftMonth(this.month(), step);
    void this.router.navigate([], { queryParams: { month: next === this.thisMonth ? null : next }, replaceUrl: true });
  }

  protected open(userId: string): void {
    void this.router.navigate(['/m/hours', userId], { queryParams: { month: this.month() } });
  }

  protected levelOf(value: number, limit: number): 'ok' | 'near' | 'over' {
    return value > limit ? 'over' : value >= limit * this.R.warnShare ? 'near' : 'ok';
  }

  protected share(value: number, limit: number): number {
    return Math.min(100, (value / limit) * 100);
  }

  protected shortKey(i: WorkIssue): TranslationKey {
    return `hours.short.${i.kind}` as TranslationKey;
  }

  protected issueText(i: WorkIssue): string {
    return this.i18n.t(`hours.issue.${i.kind}` as TranslationKey, { value: String(Math.round((i.value / 60) * 10) / 10).replace('.', ','), limit: i.limit / 60 });
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  protected tone(name: string): number {
    return avatarTone(name);
  }
}
