import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { OrgService } from '../../core/org/org.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { HoursResponse } from '../../core/models/api.models';
import type { DailySummary, IsoDate, User } from '../../core/models/domain.models';
import { WORKTIME_RULES, analyzeMonth, hm, monthDays, weekday, type WorkDay, type WorkIssue, type WorkMonth } from '../../core/worktime/worktime';
import { LogoComponent } from '../ui/logo.component';

interface DayRow {
  readonly date: IsoDate;
  readonly weekend: boolean;
  readonly day: WorkDay | null;
  readonly orders: string;
  readonly report: DailySummary['status'] | null;
  readonly flagged: boolean;
}

interface WeekRow {
  readonly n: number;
  readonly minutes: number;
  readonly overtime: number;
  readonly longestRest: number | null;
}

type Line = { readonly kind: 'day'; readonly row: DayRow } | { readonly kind: 'week'; readonly row: WeekRow };

interface Check {
  readonly rule: TranslationKey;
  readonly article: number;
  readonly limit: string;
  readonly actual: string;
  readonly level: 'ok' | 'near' | 'over' | 'none';
}

/** ISO 8601 week number of a YYYY-MM-DD date. */
function isoWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

const h = (minutes: number): string => String(Math.round((minutes / 60) * 10) / 10).replace('.', ',');

/**
 * One worker's monthly record of working time as an A4 sheet: every day of the month with arrival, departure,
 * regular time, overtime and the rest before it, weekly subtotals, a check against the ZDR-1 limits and lines
 * to sign. Print-to-PDF keeps it exact; on a phone the day table scrolls sideways.
 */
@Component({
  selector: 'aon-work-record',
  imports: [LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (user(); as u) {
      <article class="rec">
        <header class="rec-head">
          <div class="rec-brand">
            <aon-logo [size]="1.15" />
            <p class="rec-kicker">{{ i18n.t('rec.basis') }}</p>
          </div>
          <div class="rec-titleblock">
            <h1 class="rec-title">{{ i18n.t('rec.title') }}</h1>
            @if (org.name(); as employer) {
              <p class="rec-employer">{{ i18n.t('rec.employer') }}: {{ employer }}</p>
            }
            <p class="rec-period">{{ monthLabel() }}</p>
          </div>
        </header>

        <dl class="rec-meta">
          <div><dt>{{ i18n.t('rec.worker') }}</dt><dd class="strong">{{ u.displayName }}</dd></div>
          <div><dt>{{ i18n.t('rec.crew') }}</dt><dd>{{ u.crew || '—' }}</dd></div>
          <div><dt>{{ i18n.t('rec.period') }}</dt><dd>{{ periodLabel() }}</dd></div>
          <div><dt>{{ i18n.t('rec.docNo') }}</dt><dd class="num">{{ docNo() }}</dd></div>
          <div><dt>{{ i18n.t('rec.generated') }}</dt><dd class="num">{{ generated() }}</dd></div>
        </dl>

        <section class="rec-figs" [attr.aria-label]="i18n.t('rec.sumHours')">
          <div class="fig">
            <p class="fig-k">{{ i18n.t('rec.sumHours') }}</p>
            <p class="fig-v num">{{ hm(m().minutes) }}<span class="fig-u">h</span></p>
            <p class="fig-s">{{ i18n.t('rec.sumDays') }}: {{ m().days.length }}</p>
          </div>
          <div class="fig">
            <p class="fig-k">{{ i18n.t('rec.sumRegular') }}</p>
            <p class="fig-v num">{{ hm(m().regular) }}<span class="fig-u">h</span></p>
            <p class="fig-s">8 h / {{ i18n.t('mgr.colDay').toLowerCase() }} · 40 h / 7</p>
          </div>
          <div class="fig" [attr.data-level]="levelOf(m().overtime, R.overtimeMonthMin)">
            <p class="fig-k">{{ i18n.t('rec.sumOvertime') }}</p>
            <p class="fig-v num">{{ hm(m().overtime) }}<span class="fig-u">h</span></p>
            <span class="meter" aria-hidden="true"><span [style.width.%]="share(m().overtime, R.overtimeMonthMin)"></span></span>
            <p class="fig-s">{{ i18n.t('rec.ofLimit', { limit: R.overtimeMonthMin / 60 }) }}</p>
          </div>
          <div class="fig" [attr.data-level]="levelOf(m().overtimeYear, R.overtimeYearMin)">
            <p class="fig-k">{{ i18n.t('rec.sumYear') }}</p>
            <p class="fig-v num">{{ hm(m().overtimeYear) }}<span class="fig-u">h</span></p>
            <span class="meter" aria-hidden="true"><span [style.width.%]="share(m().overtimeYear, R.overtimeYearMin)"></span></span>
            <p class="fig-s">{{ i18n.t('rec.ofLimit', { limit: R.overtimeYearMin / 60 }) }}</p>
          </div>
        </section>

        <section class="rec-sec">
          <h2 class="rec-h">{{ i18n.t('rec.daysTitle') }}</h2>
          <div class="scroll">
            <table class="days">
              <thead>
                <tr>
                  <th scope="col">{{ i18n.t('rec.colDate') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.colIn') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.colOut') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.colHours') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.colRegular') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.colOvertime') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.colRest') }}</th>
                  <th scope="col">{{ i18n.t('rec.colOrders') }}</th>
                  <th scope="col">{{ i18n.t('rec.colReport') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines(); track $index) {
                  @if (line.kind === 'day') {
                    @let r = line.row;
                    <tr class="d" [class.we]="r.weekend" [class.off]="!r.day" [class.flag]="r.flagged">
                      <th scope="row" class="dt">{{ dayLabel(r.date) }}</th>
                      @if (r.day; as d) {
                        <td class="r num">{{ i18n.time(d.firstStart) }}</td>
                        <td class="r num">
                          @if (d.lastEnd !== null) {
                            {{ i18n.time(d.lastEnd) }}@if (nextDay(d)) {<sup class="plus">+1</sup>}@if (d.declared) {<span class="star" [title]="i18n.t('hours.issue.DECLARED_END')">*</span>}
                          } @else {
                            <span class="muted">{{ i18n.t('rec.running') }}</span>
                          }
                        </td>
                        <td class="r num strong" [class.bad]="d.minutes > R.maxDayMin">{{ hm(d.minutes) }}</td>
                        <td class="r num">{{ hm(d.regular) }}</td>
                        <td class="r num" [class.ot]="d.overtime > 0">{{ d.overtime ? hm(d.overtime) : '–' }}</td>
                        <td class="r num" [class.bad]="d.restBefore !== null && d.restBefore < R.dailyRestMin">{{ d.restBefore === null ? '–' : restLabel(d.restBefore) }}</td>
                        <td class="orders">{{ r.orders || '–' }}</td>
                        <td class="rep">{{ r.report ? i18n.t(reportKey(r.report)) : '–' }}</td>
                      } @else {
                        <td class="r muted" colspan="6"></td>
                        <td></td>
                        <td></td>
                      }
                    </tr>
                  } @else {
                    @let w = line.row;
                    <tr class="wk">
                      <th scope="row">{{ i18n.t('rec.week', { n: w.n }) }}</th>
                      <td colspan="2" class="r muted nowrap">{{ w.longestRest === null ? '' : i18n.t('rec.weekRest', { h: h(w.longestRest) }) }}</td>
                      <td class="r num strong" [class.bad]="w.minutes > R.maxWeekMin">{{ hm(w.minutes) }}</td>
                      <td class="r num">{{ hm(w.minutes - w.overtime) }}</td>
                      <td class="r num" [class.ot]="w.overtime > 0" [class.bad]="w.overtime > R.overtimeWeekMin">{{ w.overtime ? hm(w.overtime) : '–' }}</td>
                      <td colspan="3"></td>
                    </tr>
                  }
                }
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{{ i18n.t('rec.total') }}</th>
                  <td colspan="2"></td>
                  <td class="r num">{{ hm(m().minutes) }}</td>
                  <td class="r num">{{ hm(m().regular) }}</td>
                  <td class="r num">{{ hm(m().overtime) }}</td>
                  <td colspan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section class="rec-sec keep">
          <h2 class="rec-h">{{ i18n.t('rec.checkTitle') }}</h2>
          <div class="scroll">
            <table class="checks">
              <thead>
                <tr>
                  <th scope="col">{{ i18n.t('rec.checkRule') }}</th>
                  <th scope="col">{{ i18n.t('rec.checkBasis') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.checkLimit') }}</th>
                  <th scope="col" class="r">{{ i18n.t('rec.checkActual') }}</th>
                  <th scope="col">{{ i18n.t('rec.checkResult') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (c of checks(); track c.rule) {
                  <tr>
                    <th scope="row">{{ i18n.t(c.rule) }}</th>
                    <td class="muted">{{ i18n.t('rec.article', { n: c.article }) }}</td>
                    <td class="r num">{{ c.limit }}</td>
                    <td class="r num strong">{{ c.actual }}</td>
                    <td><span class="res" [attr.data-level]="c.level">{{ resultLabel(c.level) }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="rec-sec keep">
          <h2 class="rec-h">{{ i18n.t('rec.findings') }}</h2>
          @if (m().issues.length) {
            <ol class="finds">
              @for (i of m().issues; track $index) {
                <li [attr.data-level]="i.level">
                  <span class="f-date num">{{ issueDate(i) }}</span>
                  <span>{{ issueText(i) }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="none">{{ i18n.t('rec.noFindings') }}</p>
          }
        </section>

        <section class="rec-notes keep">
          <h2 class="rec-h small">{{ i18n.t('rec.notes') }}</h2>
          <p>{{ i18n.t('rec.note1') }}</p>
          <p>{{ i18n.t('rec.note2') }}</p>
          <p>{{ i18n.t('rec.note3') }}</p>
        </section>

        <section class="sign keep">
          <div>
            <span class="line"></span>
            <p>{{ i18n.t('rec.signWorker') }} · {{ u.displayName }}</p>
          </div>
          <div>
            <span class="line"></span>
            <p>{{ i18n.t('rec.signEmployer') }}</p>
          </div>
          <div class="sign-date">
            <span class="line"></span>
            <p>{{ i18n.t('rec.signDate') }}</p>
          </div>
        </section>

        <footer class="rec-foot">
          <span>{{ i18n.t('rec.title') }} · {{ u.displayName }} · {{ monthLabel() }}</span>
          <span class="num">{{ docNo() }}</span>
        </footer>
      </article>
    }
  `,
  styles: `
    :host {
      display: block;
      container: rec / inline-size;
      color: #161616;
      --rule: #1b1b1b;
      --hair: #dcd9d1;
      --soft: #f5f3ee;
      --muted: #6a6862;
      --gold: #a8873a;
      --gold-fill: #f3ead3;
      --bad: #b3121b;
      --bad-fill: #fbe5e6;
      --ok: #1d6b38;
    }
    .rec {
      font-size: 9.5pt;
      line-height: 1.4;
      font-variant-numeric: tabular-nums;
    }
    .num {
      font-variant-numeric: tabular-nums;
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--muted);
    }
    .r {
      text-align: right;
    }
    /* Head: wordmark left, title block right, one heavy rule under both. */
    .rec-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem 2rem;
      padding-bottom: 0.7rem;
      border-bottom: 2.5px solid var(--rule);
    }
    .rec-kicker {
      margin-top: 0.35rem;
      color: var(--muted);
      font-size: 7.5pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .rec-titleblock {
      text-align: right;
    }
    .rec-title {
      font-size: 17pt;
      font-weight: 650;
      letter-spacing: -0.015em;
      line-height: 1.1;
    }
    .rec-employer {
      margin-top: 0.15rem;
      font-size: 9pt;
      font-weight: 600;
    }
    .rec-period {
      margin-top: 0.15rem;
      color: var(--gold);
      font-size: 11pt;
      font-weight: 600;
      text-transform: capitalize;
    }
    .rec-meta {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr 1.6fr 1.3fr 1.1fr;
      border-bottom: 1px solid var(--hair);
    }
    .rec-meta > div {
      padding: 0.55rem 0.7rem 0.55rem 0;
    }
    .rec-meta > div + div {
      padding-left: 0.7rem;
      border-left: 1px solid var(--hair);
    }
    .rec-meta dt,
    .fig-k,
    .days thead th,
    .checks thead th {
      color: var(--muted);
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .rec-meta dd {
      margin-top: 0.1rem;
      white-space: nowrap;
    }
    /* Key figures: four cells, the overtime ones with a meter against the legal cap. */
    .rec-figs {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 0.9rem;
      border: 1px solid var(--hair);
      border-radius: 4px;
    }
    .fig {
      padding: 0.6rem 0.75rem 0.65rem;
    }
    .fig + .fig {
      border-left: 1px solid var(--hair);
    }
    .fig-v {
      margin-top: 0.15rem;
      font-size: 17pt;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .fig-u {
      margin-left: 0.15rem;
      color: var(--muted);
      font-size: 9pt;
      font-weight: 500;
    }
    .fig-s {
      margin-top: 0.2rem;
      color: var(--muted);
      font-size: 7.5pt;
    }
    .meter {
      display: block;
      height: 4px;
      margin-top: 0.35rem;
      border-radius: 2px;
      background: var(--soft);
      overflow: hidden;
    }
    .meter > span {
      display: block;
      height: 100%;
      background: var(--gold);
    }
    .fig[data-level='near'] .meter > span {
      background: #c98a12;
    }
    .fig[data-level='over'] .meter > span {
      background: var(--bad);
    }
    .fig[data-level='over'] .fig-v {
      color: var(--bad);
    }
    .rec-sec {
      margin-top: 1.1rem;
    }
    .rec-h {
      margin-bottom: 0.3rem;
      font-size: 10.5pt;
      font-weight: 650;
    }
    .rec-h.small {
      font-size: 8.5pt;
    }
    .scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    .days {
      min-width: 40rem;
      font-size: 8.4pt;
    }
    .days th,
    .days td,
    .checks th,
    .checks td {
      padding: 0.2rem 0.4rem;
      text-align: left;
      vertical-align: baseline;
    }
    .days .r,
    .checks .r {
      text-align: right;
    }
    .days thead th,
    .checks thead th {
      padding-top: 0.35rem;
      padding-bottom: 0.35rem;
      border-bottom: 1.5px solid var(--rule);
      white-space: nowrap;
    }
    .days thead th:first-child,
    .days tbody th,
    .days tfoot th {
      padding-left: 0;
    }
    .days tbody tr.d {
      border-bottom: 1px solid #eeece6;
      break-inside: avoid;
    }
    .dt {
      font-weight: 500;
      white-space: nowrap;
    }
    .d.we {
      background: var(--soft);
    }
    .d.off .dt {
      color: var(--muted);
      font-weight: 400;
    }
    .d.flag .dt {
      box-shadow: inset 2px 0 0 var(--bad);
      padding-left: 0.35rem;
    }
    td.ot {
      color: #7a5d17;
      font-weight: 600;
    }
    td.bad {
      color: var(--bad);
      font-weight: 700;
    }
    .plus {
      margin-left: 1px;
      color: var(--muted);
      font-size: 6.5pt;
    }
    .star {
      margin-left: 1px;
      color: var(--bad);
      font-weight: 700;
    }
    .nowrap {
      white-space: nowrap;
    }
    .orders {
      max-width: 11rem;
      color: #333;
    }
    .rep {
      color: var(--muted);
      white-space: nowrap;
    }
    .wk {
      border-top: 1px solid #cfccc4;
      border-bottom: 1.5px solid #cfccc4;
      background: var(--gold-fill);
      font-size: 8pt;
      break-inside: avoid;
    }
    .wk th {
      padding-left: 0;
      font-weight: 650;
      white-space: nowrap;
    }
    .days tfoot tr {
      border-top: 2px solid var(--rule);
      font-weight: 700;
    }
    .days tfoot th,
    .days tfoot td {
      padding-top: 0.35rem;
    }
    .checks {
      min-width: 34rem;
      font-size: 8.6pt;
    }
    .checks tbody tr {
      border-bottom: 1px solid #eeece6;
    }
    .checks tbody th {
      padding-left: 0;
      font-weight: 500;
    }
    .checks thead th:first-child {
      padding-left: 0;
    }
    .res {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-weight: 650;
      white-space: nowrap;
    }
    .res::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      background: currentColor;
    }
    .res[data-level='ok'] {
      color: var(--ok);
    }
    .res[data-level='near'] {
      color: #9a6a0c;
    }
    .res[data-level='over'] {
      color: var(--bad);
    }
    .res[data-level='none'] {
      color: var(--muted);
      font-weight: 500;
    }
    .finds {
      display: grid;
      gap: 0.15rem;
      font-size: 8.8pt;
    }
    .finds li {
      display: grid;
      grid-template-columns: 6.5rem minmax(0, 1fr);
      gap: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-left: 3px solid var(--hair);
    }
    .finds li[data-level='over'] {
      border-left-color: var(--bad);
      background: var(--bad-fill);
    }
    .finds li[data-level='near'] {
      border-left-color: #c98a12;
      background: #fbf1dc;
    }
    .f-date {
      color: var(--muted);
      white-space: nowrap;
    }
    .none {
      color: var(--ok);
      font-weight: 600;
    }
    .rec-notes {
      margin-top: 1.1rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7.6pt;
    }
    .rec-notes p + p {
      margin-top: 0.15rem;
    }
    .sign {
      display: grid;
      grid-template-columns: 1.3fr 1.3fr 0.8fr;
      gap: 1.5rem;
      margin-top: 2.2rem;
    }
    .sign .line {
      display: block;
      height: 2.2rem;
      border-bottom: 1px solid var(--rule);
    }
    .sign p {
      margin-top: 0.25rem;
      color: var(--muted);
      font-size: 7.5pt;
    }
    .rec-foot {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin-top: 1.4rem;
      padding-top: 0.35rem;
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7pt;
    }
    .keep {
      break-inside: avoid;
    }
    @container rec (max-width: 640px) {
      .rec-titleblock {
        text-align: left;
      }
      .rec-meta {
        grid-template-columns: 1fr 1fr;
      }
      .rec-meta > div,
      .rec-meta > div + div {
        padding: 0.45rem 0.6rem 0.45rem 0;
        border-left: 0;
        border-top: 1px solid var(--hair);
      }
      .rec-meta dd {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .rec-figs {
        grid-template-columns: 1fr 1fr;
      }
      .fig:nth-child(3) {
        border-left: 0;
      }
      .fig:nth-child(n + 3) {
        border-top: 1px solid var(--hair);
      }
      .sign {
        grid-template-columns: 1fr;
        gap: 0.5rem;
      }
    }
    @media print {
      .scroll {
        overflow: visible;
      }
      .days,
      .checks {
        min-width: 0;
      }
    }
  `,
})
export class WorkRecordComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly org = inject(OrgService);
  private readonly orgLoad = this.org.load();
  protected readonly R = WORKTIME_RULES;
  protected readonly hm = hm;
  protected readonly h = h;

  readonly data = input.required<HoursResponse>();
  readonly userId = input.required<string>();
  /** Clock for open shifts and "prepared at"; the page passes the server time it loaded with. */
  readonly now = input<number>(Date.now());

  protected readonly user = computed<User | null>(() => this.data().workers.find((w) => w.id === this.userId()) ?? null);
  protected readonly m = computed<WorkMonth>(() =>
    analyzeMonth(
      this.data().shifts.filter((s) => s.userId === this.userId()),
      this.data().month,
      this.now(),
    ),
  );

  protected readonly monthLabel = computed(() => {
    const [y, mo] = this.data().month.split('-').map(Number);
    return new Intl.DateTimeFormat(this.i18n.locale(), { month: 'long', year: 'numeric' }).format(new Date(y ?? 1970, (mo ?? 1) - 1, 1));
  });
  protected readonly periodLabel = computed(() => {
    const days = monthDays(this.data().month);
    return `${this.i18n.dateShort(days[0] ?? '')} – ${this.i18n.dateShort(days.at(-1) ?? '')}`;
  });
  protected readonly docNo = computed(() => `EDČ-${this.data().month.replace('-', '')}-${this.userId().replace(/[^a-z0-9]/gi, '').slice(-5).toUpperCase()}`);
  protected readonly generated = computed(() => `${this.i18n.dateShort(this.now())} ${this.i18n.time(this.now())}`);

  private readonly weekdayFmt = computed(() => new Intl.DateTimeFormat(this.i18n.locale(), { weekday: 'short' }));

  /** Every day of the month, with a subtotal line after each Sunday and after the month's last day. */
  protected readonly lines = computed<Line[]>(() => {
    const month = this.m();
    const data = this.data();
    const uid = this.userId();
    const byDate = new Map(month.days.map((d) => [d.date, d]));
    const flagged = new Set(month.issues.filter((i) => i.level === 'over' && (i.kind === 'DAY_OVER' || i.kind === 'REST_DAILY' || i.kind === 'OPEN_LONG')).map((i) => i.date));
    const orderById = new Map(data.orders.map((o) => [o.id, o]));
    const reports = new Map(data.summaries.filter((s) => s.userId === uid).map((s) => [s.date, s.status]));
    const codesBy = new Map<string, Set<string>>();
    for (const s of data.segments) {
      if (s.userId !== uid || !s.workOrderId) continue;
      const o = orderById.get(s.workOrderId);
      const set = codesBy.get(s.date) ?? new Set<string>();
      set.add(o?.code ?? o?.title ?? '');
      codesBy.set(s.date, set);
    }
    const weeks = new Map(month.weeks.map((w) => [w.start, w]));
    const out: Line[] = [];
    const days = monthDays(data.month);
    days.forEach((date, i) => {
      const wd = weekday(date);
      out.push({
        kind: 'day',
        row: {
          date,
          weekend: wd >= 5,
          day: byDate.get(date) ?? null,
          orders: this.codes([...(codesBy.get(date) ?? [])].filter(Boolean)),
          report: reports.get(date) ?? null,
          flagged: flagged.has(date),
        },
      });
      if (wd === 6 || i === days.length - 1) {
        const monday = [...weeks.keys()].filter((k) => k <= date).at(-1);
        const w = monday ? weeks.get(monday) : undefined;
        if (w && w.minutes > 0) out.push({ kind: 'week', row: { n: isoWeek(date), minutes: w.minutes, overtime: w.overtime, longestRest: w.longestRest } });
      }
    });
    return out;
  });

  protected readonly checks = computed<Check[]>(() => {
    const m = this.m();
    const R = this.R;
    const worked = m.weeks.filter((w) => w.minutes > 0);
    const rests = m.days.map((d) => d.restBefore).filter((r): r is number => r !== null);
    const weekRests = worked.map((w) => w.longestRest).filter((r): r is number => r !== null);
    const maxWeek = Math.max(0, ...worked.map((w) => w.minutes));
    const maxWeekOt = Math.max(0, ...worked.map((w) => w.overtime));
    const atMost = (min: number): string => this.i18n.t('rec.atMost', { h: min / 60 });
    const atLeast = (min: number): string => this.i18n.t('rec.atLeast', { h: min / 60 });
    const cap = (value: number, limit: number): Check['level'] => (value > limit ? 'over' : value >= limit * R.warnShare && limit >= R.overtimeMonthMin ? 'near' : 'ok');
    const floor = (value: number | null, limit: number): Check['level'] => (value === null ? 'none' : value < limit ? 'over' : 'ok');
    const minRest = rests.length ? Math.min(...rests) : null;
    const minWeekRest = weekRests.length ? Math.min(...weekRests) : null;
    return [
      { rule: 'rec.rule.day', article: 144, limit: atMost(R.maxDayMin), actual: `${hm(m.longestDay)} h`, level: m.days.length ? cap(m.longestDay, R.maxDayMin) : 'none' },
      { rule: 'rec.rule.week', article: 148, limit: atMost(R.maxWeekMin), actual: `${hm(maxWeek)} h`, level: worked.length ? cap(maxWeek, R.maxWeekMin) : 'none' },
      { rule: 'rec.rule.otWeek', article: 144, limit: atMost(R.overtimeWeekMin), actual: `${hm(maxWeekOt)} h`, level: worked.length ? cap(maxWeekOt, R.overtimeWeekMin) : 'none' },
      { rule: 'rec.rule.otMonth', article: 144, limit: atMost(R.overtimeMonthMin), actual: `${hm(m.overtime)} h`, level: cap(m.overtime, R.overtimeMonthMin) },
      { rule: 'rec.rule.otYear', article: 144, limit: atMost(R.overtimeYearMin), actual: `${hm(m.overtimeYear)} h`, level: cap(m.overtimeYear, R.overtimeYearMin) },
      { rule: 'rec.rule.restDaily', article: 155, limit: atLeast(R.dailyRestMin), actual: minRest === null ? '–' : `${h(minRest)} h`, level: floor(minRest, R.dailyRestMin) },
      { rule: 'rec.rule.restWeekly', article: 156, limit: atLeast(R.weeklyRestMin), actual: minWeekRest === null ? '–' : `${h(minWeekRest)} h`, level: floor(minWeekRest, R.weeklyRestMin) },
    ];
  });

  protected dayLabel(date: IsoDate): string {
    return `${this.weekdayFmt().format(new Date(`${date}T12:00:00`)).replace('.', '')} ${this.i18n.dateDay(date)}`;
  }

  /** Departure after midnight belongs to the day the shift started; mark it. */
  protected nextDay(d: WorkDay): boolean {
    return d.lastEnd !== null && new Date(d.lastEnd).toDateString() !== new Date(`${d.date}T12:00:00`).toDateString();
  }

  /** Up to three order codes, then a count, so a busy day stays one line. */
  private codes(list: readonly string[]): string {
    // Non-breaking hyphen: an order number never splits across two lines.
    const nb = list.map((c) => c.replaceAll('-', '‑'));
    return nb.length > 3 ? `${nb.slice(0, 3).join(', ')} +${nb.length - 3}` : nb.join(', ');
  }

  protected restLabel(min: number): string {
    return `${h(min)} h`;
  }

  protected reportKey(status: string): TranslationKey {
    return `reports.status${status}` as TranslationKey;
  }

  protected levelOf(value: number, limit: number): 'ok' | 'near' | 'over' {
    return value > limit ? 'over' : value >= limit * this.R.warnShare ? 'near' : 'ok';
  }

  protected share(value: number, limit: number): number {
    return Math.min(100, (value / limit) * 100);
  }

  protected resultLabel(level: Check['level']): string {
    return level === 'none' ? '–' : this.i18n.t(level === 'ok' ? 'hours.ok' : level === 'near' ? 'hours.near' : 'hours.over');
  }

  protected issueDate(i: WorkIssue): string {
    if (i.kind === 'OT_MONTH' || i.kind === 'OT_MONTH_NEAR' || i.kind === 'OT_YEAR' || i.kind === 'OT_YEAR_NEAR') return this.monthLabel();
    if (i.kind === 'WEEK_OVER' || i.kind === 'OT_WEEK' || i.kind === 'REST_WEEKLY') return this.i18n.t('rec.week', { n: isoWeek(i.date) });
    return this.dayLabel(i.date);
  }

  protected issueText(i: WorkIssue): string {
    return this.i18n.t(`hours.issue.${i.kind}` as TranslationKey, { value: h(i.value), limit: i.limit / 60 });
  }
}
