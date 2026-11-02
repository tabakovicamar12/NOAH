import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { OrgService } from '../../core/org/org.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { HoursResponse } from '../../core/models/api.models';
import type { DailySummary, IsoDate, User } from '../../core/models/domain.models';
import { analyzeMonth, hm, monthDays, weekday, type WorkDay, type WorkMonth } from '../../core/worktime/worktime';
import { LogoComponent } from '../ui/logo.component';

interface DayRow {
  readonly date: IsoDate;
  readonly weekend: boolean;
  readonly day: WorkDay | null;
  readonly orders: string;
  readonly report: DailySummary['status'] | null;
}

interface WeekRow {
  readonly n: number;
  readonly minutes: number;
  readonly overtime: number;
  readonly longestRest: number | null;
}

type Line = { readonly kind: 'day'; readonly row: DayRow } | { readonly kind: 'week'; readonly row: WeekRow };

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
 * regular time, overtime and the rest before it, weekly subtotals and lines to sign. A plain sheet to print and
 * sign: legal limits are checked for the manager on the Delovni čas page, not here. Print-to-PDF keeps it exact;
 * on a phone the day table scrolls sideways.
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
          <div class="fig">
            <p class="fig-k">{{ i18n.t('rec.sumOvertime') }}</p>
            <p class="fig-v num">{{ hm(m().overtime) }}<span class="fig-u">h</span></p>
          </div>
          <div class="fig">
            <p class="fig-k">{{ i18n.t('rec.sumYear') }}</p>
            <p class="fig-v num">{{ hm(m().overtimeYear) }}<span class="fig-u">h</span></p>
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
                    <tr class="d" [class.we]="r.weekend" [class.off]="!r.day">
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
                        <td class="r num strong">{{ hm(d.minutes) }}</td>
                        <td class="r num">{{ hm(d.regular) }}</td>
                        <td class="r num" [class.ot]="d.overtime > 0">{{ d.overtime ? hm(d.overtime) : '–' }}</td>
                        <td class="r num">{{ d.restBefore === null ? '–' : restLabel(d.restBefore) }}</td>
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
                      <td class="r num strong">{{ hm(w.minutes) }}</td>
                      <td class="r num">{{ hm(w.minutes - w.overtime) }}</td>
                      <td class="r num" [class.ot]="w.overtime > 0">{{ w.overtime ? hm(w.overtime) : '–' }}</td>
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

        <section class="rec-notes keep">
          <p>{{ i18n.t('rec.note1') }}</p>
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
      gap: calc(0.75 * var(--doc-u)) calc(2 * var(--doc-u));
      padding-bottom: calc(0.7 * var(--doc-u));
      border-bottom: 2.5px solid var(--rule);
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
      margin-top: calc(0.15 * var(--doc-u));
      font-size: 9pt;
      font-weight: 600;
    }
    .rec-period {
      margin-top: calc(0.15 * var(--doc-u));
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
      padding: calc(0.55 * var(--doc-u)) calc(0.7 * var(--doc-u)) calc(0.55 * var(--doc-u)) 0;
    }
    .rec-meta > div + div {
      padding-left: calc(0.7 * var(--doc-u));
      border-left: 1px solid var(--hair);
    }
    .rec-meta dt,
    .fig-k,
    .days thead th {
      color: var(--muted);
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .rec-meta dd {
      margin-top: calc(0.1 * var(--doc-u));
      white-space: nowrap;
    }
    /* Key figures: four cells. */
    .rec-figs {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: calc(0.9 * var(--doc-u));
      border: 1px solid var(--hair);
      border-radius: 4px;
    }
    .fig {
      padding: calc(0.6 * var(--doc-u)) calc(0.75 * var(--doc-u)) calc(0.65 * var(--doc-u));
    }
    .fig + .fig {
      border-left: 1px solid var(--hair);
    }
    .fig-v {
      margin-top: calc(0.15 * var(--doc-u));
      font-size: 17pt;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .fig-u {
      margin-left: calc(0.15 * var(--doc-u));
      color: var(--muted);
      font-size: 9pt;
      font-weight: 500;
    }
    .fig-s {
      margin-top: calc(0.2 * var(--doc-u));
      color: var(--muted);
      font-size: 7.5pt;
    }
    .rec-sec {
      margin-top: calc(1.1 * var(--doc-u));
    }
    .rec-h {
      margin-bottom: calc(0.3 * var(--doc-u));
      font-size: 10.5pt;
      font-weight: 650;
    }
    .scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    .days {
      min-width: calc(40 * var(--doc-u));
      font-size: 8.4pt;
    }
    .days th,
    .days td {
      padding: calc(0.2 * var(--doc-u)) calc(0.4 * var(--doc-u));
      text-align: left;
      vertical-align: baseline;
    }
    .days .r {
      text-align: right;
    }
    .days thead th {
      padding-top: calc(0.35 * var(--doc-u));
      padding-bottom: calc(0.35 * var(--doc-u));
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
    td.ot {
      color: #7a5d17;
      font-weight: 600;
    }
    .plus {
      margin-left: 1px;
      color: var(--muted);
      font-size: 6.5pt;
    }
    .star {
      margin-left: 1px;
      font-weight: 700;
    }
    .nowrap {
      white-space: nowrap;
    }
    .orders {
      max-width: calc(11 * var(--doc-u));
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
      padding-top: calc(0.35 * var(--doc-u));
    }
    .rec-notes {
      margin-top: calc(1.1 * var(--doc-u));
      padding-top: calc(0.6 * var(--doc-u));
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7.6pt;
    }
    .sign {
      display: grid;
      grid-template-columns: 1.3fr 1.3fr 0.8fr;
      gap: calc(1.5 * var(--doc-u));
      margin-top: calc(2.2 * var(--doc-u));
    }
    .sign .line {
      display: block;
      height: calc(2.2 * var(--doc-u));
      border-bottom: 1px solid var(--rule);
    }
    .sign p {
      margin-top: calc(0.25 * var(--doc-u));
      color: var(--muted);
      font-size: 7.5pt;
    }
    .rec-foot {
      display: flex;
      justify-content: space-between;
      gap: calc(1 * var(--doc-u));
      margin-top: calc(1.4 * var(--doc-u));
      padding-top: calc(0.35 * var(--doc-u));
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
        padding: calc(0.45 * var(--doc-u)) calc(0.6 * var(--doc-u)) calc(0.45 * var(--doc-u)) 0;
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
        gap: calc(0.5 * var(--doc-u));
      }
    }
    @media screen and (max-width: 1100px) {
      .days th:first-child,
      .days .dt {
        position: sticky;
        left: 0;
        z-index: 1;
        padding-right: calc(0.5 * var(--doc-u));
        background: #fff;
      }
      .d.we .dt {
        background: var(--soft);
      }
    }
    @media print {
      .scroll {
        overflow: visible;
      }
      /* One A4 sheet to sign, also in a month with every week filled in. */
      .days {
        min-width: 0;
        font-size: 8pt;
        line-height: 1.15;
      }
      .days th,
      .days td {
        padding-block: 1.5px;
      }
      .days thead th {
        padding-block: 3px;
      }
      .wk {
        font-size: 7.6pt;
      }
      .rec-figs {
        margin-top: 8px;
      }
      .fig {
        padding-block: 5px;
      }
      .fig-v {
        font-size: 14pt;
      }
      .rec-sec {
        margin-top: 8px;
      }
      .rec-notes {
        margin-top: 8px;
        padding-top: 4px;
      }
      .sign {
        margin-top: 12px;
      }
      .sign .line {
        height: 26px;
      }
      .rec-foot {
        margin-top: 8px;
      }
    }
  `,
})
export class WorkRecordComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly org = inject(OrgService);
  private readonly orgLoad = this.org.load();
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
}
