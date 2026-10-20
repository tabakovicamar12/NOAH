import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { OrgService } from '../../core/org/org.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { IsoDate, LogEntry, WorkOrder, WorkOrderStatus } from '../../core/models/domain.models';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { compareCodes, isIsoDate, toIsoDate } from '../../core/util/util';
import { WORKTIME_RULES, addDays, hm } from '../../core/worktime/worktime';
import { IconComponent } from '../../shared/ui/icon.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { ManagerStore } from './data/manager-store.service';

interface IssueLine {
  readonly code: string;
  readonly title: string;
  readonly site: string;
  readonly assignee: string | null;
  readonly logs: readonly LogEntry[];
}

const STATUS_RANK: Readonly<Record<WorkOrderStatus, number>> = { ISSUE: 0, IN_PROGRESS: 1, NEW: 2, COMPLETED: 3 };
const R = WORKTIME_RULES;

/**
 * Daily site report as an A4 sheet: who was on site and for how long, every active order, open problems and a
 * line to sign. Export is the browser's own print-to-PDF: works offline, keeps the real typeface and Slovenian
 * diacritics, and needs no PDF library in the bundle.
 */
@Component({
  selector: 'aon-manager-report',
  imports: [RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar no-print">
      <div class="bar-l">
        <a routerLink="/m" class="back" [attr.aria-label]="i18n.t('common.back')"><aon-icon name="arrow-left" [size]="20" [stroke]="2.2" /></a>
        <div class="min-w-0">
          <h1 class="bar-title">{{ i18n.t('pdf.preview') }}</h1>
          <p class="bar-sub">{{ i18n.t('pdf.hint') }}</p>
        </div>
      </div>
      <div class="bar-r">
        <div class="month" role="group" [attr.aria-label]="i18n.t('pdf.date')">
          <button type="button" class="mbtn" [attr.aria-label]="i18n.t('mgr.prevPage')" (click)="step(-1)"><aon-icon name="chevron-left" [size]="18" /></button>
          <span class="mlabel">{{ i18n.date(store.date()) }}</span>
          <button type="button" class="mbtn" [disabled]="store.isToday()" [attr.aria-label]="i18n.t('mgr.nextPage')" (click)="step(1)"><aon-icon name="chevron-right" [size]="18" /></button>
        </div>
        <button type="button" class="print" [disabled]="!data()" (click)="print()"><aon-icon name="printer" [size]="18" />{{ i18n.t('pdf.print') }}</button>
      </div>
    </div>

    <div class="stage">
      @if (store.state() === 'CACHED') {
        <p class="banner no-print"><aon-icon name="cloud-off" [size]="18" />{{ i18n.t('mgr.offlineCached', { time: cachedAt() }) }}</p>
      }

      @if (data(); as d) {
        <article class="paper sheet">
          <header class="s-head">
            <div>
              <aon-logo [size]="1.15" />
              <p class="kicker">{{ org.name() ? org.name() + ' · ' : '' }}{{ scopeLabel() }}</p>
            </div>
            <div class="s-titleblock">
              <h1 class="s-title">{{ i18n.t('pdf.docDaily') }}</h1>
              <p class="s-date">{{ i18n.dateLong(d.date) }}</p>
            </div>
          </header>

          <dl class="meta">
            <div><dt>{{ i18n.t('pdf.date') }}</dt><dd class="num">{{ i18n.dateShort(d.date) }}</dd></div>
            <div><dt>{{ i18n.t('pdf.scope') }}</dt><dd>{{ scopeLabel() }}</dd></div>
            <div><dt>{{ i18n.t('pdf.preparedBy') }}</dt><dd>{{ preparer() }}</dd></div>
            <div><dt>{{ i18n.t('rec.docNo') }}</dt><dd class="num">{{ docNo() }}</dd></div>
            <div><dt>{{ i18n.t('rec.generated') }}</dt><dd class="num">{{ generated() }}</dd></div>
          </dl>
          @if (demo) {
            <p class="demo">{{ i18n.t('common.demo') }}</p>
          }

          <section class="figs">
            <div class="fig">
              <p class="fig-k">{{ i18n.t('pdf.kpiPresent') }}</p>
              <p class="fig-v num">{{ totals().present }}<span class="fig-u">/ {{ workers().length }}</span></p>
            </div>
            <div class="fig">
              <p class="fig-k">{{ i18n.t('pdf.kpiHours') }}</p>
              <p class="fig-v num">{{ hm(totals().minutes) }}<span class="fig-u">h</span></p>
            </div>
            <div class="fig" [class.warn]="totals().over > 0">
              <p class="fig-k">{{ i18n.t('pdf.kpiOvertime') }}</p>
              <p class="fig-v num">{{ hm(totals().over) }}<span class="fig-u">h</span></p>
            </div>
            <div class="fig">
              <p class="fig-k">{{ i18n.t('pdf.kpiOrders') }}</p>
              <p class="fig-v num">{{ totals().inProgress }}<span class="fig-u">/ {{ totals().completed }}</span></p>
            </div>
            <div class="fig" [class.bad]="totals().issues > 0">
              <p class="fig-k">{{ i18n.t('pdf.kpiIssues') }}</p>
              <p class="fig-v num">{{ totals().issues }}</p>
            </div>
          </section>

          <section class="sec">
            <h2 class="h">{{ i18n.t('pdf.workers') }}</h2>
            @if (workers().length) {
              <div class="scroll">
                <table class="t">
                  <thead>
                    <tr>
                      <th scope="col">{{ i18n.t('mgr.colWorker') }}</th>
                      <th scope="col">{{ i18n.t('mgr.colSite') }}</th>
                      <th scope="col" class="r">{{ i18n.t('pdf.colIn') }}</th>
                      <th scope="col" class="r">{{ i18n.t('pdf.colOut') }}</th>
                      <th scope="col" class="r">{{ i18n.t('pdf.colHours') }}</th>
                      <th scope="col" class="r">{{ i18n.t('pdf.colOvertime') }}</th>
                      <th scope="col">{{ i18n.t('pdf.colReport') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (w of workers(); track w.user.id) {
                      @let over = Math.max(0, w.minutesToday - R.regularDayMin);
                      <tr [class.off]="w.presence === 'NOT_STARTED'" [class.flag]="w.minutesToday > R.maxDayMin">
                        <th scope="row"><span class="strong">{{ w.user.displayName }}</span>@if (w.user.crew) {<span class="muted"> · {{ w.user.crew }}</span>}</th>
                        <td>{{ w.site ? w.site.projectName + ' · ' + w.site.name : '–' }}</td>
                        <td class="r num">{{ w.shiftStartedAt ? i18n.time(w.shiftStartedAt) : '–' }}</td>
                        <td class="r num">
                          @if (w.presence === 'WORKING') {
                            <span class="live">{{ i18n.t('rec.running') }}</span>
                          } @else {
                            {{ w.shiftEndedAt ? i18n.time(w.shiftEndedAt) : '–' }}
                          }
                        </td>
                        <td class="r num strong" [class.bad]="w.minutesToday > R.maxDayMin">{{ w.minutesToday ? hm(w.minutesToday) : '–' }}</td>
                        <td class="r num" [class.ot]="over > 0">{{ over ? hm(over) : '–' }}</td>
                        <td class="muted">{{ w.summaryStatus ? i18n.t(summaryKey(w.summaryStatus)) : '–' }}</td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">{{ i18n.t('rec.total') }}</th>
                      <td colspan="3"></td>
                      <td class="r num">{{ hm(totals().minutes) }}</td>
                      <td class="r num">{{ totals().over ? hm(totals().over) : '–' }}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              @if (anyLong()) {
                <p class="flagnote">{{ i18n.t('pdf.overLimit') }}</p>
              }
            } @else {
              <p class="none">{{ i18n.t('pdf.noWorkers') }}</p>
            }
          </section>

          <section class="sec">
            <h2 class="h">{{ i18n.t('pdf.orders') }}</h2>
            @if (orders().length) {
              <div class="scroll">
                <table class="t">
                  <thead>
                    <tr>
                      <th scope="col">{{ i18n.t('mgr.colCode') }}</th>
                      <th scope="col">{{ i18n.t('mgr.colTitle') }}</th>
                      <th scope="col">{{ i18n.t('mgr.colSite') }}</th>
                      <th scope="col">{{ i18n.t('mgr.colCrew') }}</th>
                      <th scope="col">{{ i18n.t('mgr.colStatus') }}</th>
                      <th scope="col" class="r">{{ i18n.t('pdf.colWorked') }}</th>
                      <th scope="col" class="r">{{ i18n.t('mgr.colProgress') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of orders(); track r.order.id) {
                      <tr>
                        <th scope="row" class="num strong nowrap">{{ r.order.code ?? '–' }}</th>
                        <td>{{ r.order.title }}</td>
                        <td>{{ siteName(r.order.siteId) }}</td>
                        <td>{{ crewNames(r.order.crew) }}</td>
                        <td><span class="st" [attr.data-s]="r.order.status">{{ i18n.t(statusKey(r.order.status)) }}</span></td>
                        <td class="r num">{{ r.minutesToday ? hm(r.minutesToday) : '–' }}</td>
                        <td class="r num nowrap">
                          {{ i18n.number(r.order.doneQty) }} / {{ i18n.number(r.order.plannedQty) }} {{ i18n.t(unitKey(r.order.unit)) }}
                          <span class="pbar" aria-hidden="true"><span [style.width.%]="progress(r.order)"></span></span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="none">{{ i18n.t('pdf.noOrders') }}</p>
            }
          </section>

          <section class="sec keep">
            <h2 class="h">{{ i18n.t('pdf.issues') }}</h2>
            @if (issues().length === 0) {
              <p class="none ok">{{ i18n.t('drill.noIssues') }}</p>
            } @else {
              <ol class="issues">
                @for (i of issues(); track i.code) {
                  <li>
                    <p><span class="strong num">{{ i.code }}</span> · {{ i.title }}<span class="muted"> · {{ i.site }} · {{ i.assignee ?? i18n.t('mgr.unassigned') }}</span></p>
                    @for (l of i.logs; track l.id) {
                      <p class="log"><span class="num strong">{{ i18n.time(l.createdAt) }}</span> {{ l.text }}</p>
                    }
                  </li>
                }
              </ol>
              @if (issuesLoading()) {
                <p class="none no-print">{{ i18n.t('pdf.loadIssues') }}</p>
              }
            }
          </section>

          <p class="legend keep">{{ i18n.t('pdf.legend') }}</p>

          <section class="sign keep">
            <div><span class="line"></span><p>{{ i18n.t('pdf.signManager') }}</p></div>
            <div><span class="line"></span><p>{{ i18n.t('rec.signDate') }}</p></div>
          </section>

          <footer class="s-foot">
            <span>{{ i18n.t('pdf.docDaily') }} · {{ i18n.dateShort(d.date) }}</span>
            <span class="num">{{ docNo() }}</span>
          </footer>
        </article>
      } @else if (store.state() === 'LOADING') {
        <div class="paper skel" aria-busy="true"><span class="sr-only">{{ i18n.t('common.loading') }}</span></div>
      } @else {
        <p class="banner bad" role="alert">
          <aon-icon name="alert" [size]="18" />{{ store.state() === 'EMPTY_OFFLINE' ? i18n.t('mgr.offlineNoCache') : i18n.t('mgr.loadFailed') }}
        </p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    /* Toolbar: same as the monthly record. */
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

    /* The sheet: ink on paper, hairlines, one heavy rule under the head; colour only where it means something. */
    .sheet {
      --rule: #1b1b1b;
      --hair: #dcd9d1;
      --soft: #f5f3ee;
      --muted: #6a6862;
      --gold: #a8873a;
      --bad: #b3121b;
      color: #161616;
      font-size: 9.5pt;
      line-height: 1.4;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
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
    .nowrap {
      white-space: nowrap;
    }
    .r {
      text-align: right;
    }
    .s-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem 2rem;
      padding-bottom: 0.7rem;
      border-bottom: 2.5px solid var(--rule);
    }
    .kicker {
      margin-top: 0.35rem;
      color: var(--muted);
      font-size: 7.5pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .s-titleblock {
      text-align: right;
    }
    .s-title {
      font-size: 17pt;
      font-weight: 650;
      letter-spacing: -0.015em;
      line-height: 1.1;
    }
    .s-date {
      margin-top: 0.15rem;
      color: var(--gold);
      font-size: 11pt;
      font-weight: 600;
    }
    .s-date::first-letter {
      text-transform: uppercase;
    }
    .meta {
      display: grid;
      grid-template-columns: 0.9fr 1.6fr 1.2fr 1fr 1.1fr;
      border-bottom: 1px solid var(--hair);
    }
    .meta > div {
      padding: 0.55rem 0.7rem 0.55rem 0;
    }
    .meta > div + div {
      padding-left: 0.7rem;
      border-left: 1px solid var(--hair);
    }
    .meta dt,
    .fig-k,
    .t thead th {
      color: var(--muted);
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .meta dd {
      margin-top: 0.1rem;
    }
    .demo {
      display: inline-block;
      margin-top: 0.5rem;
      padding: 0.1rem 0.5rem;
      border: 1px dashed var(--rule);
      font-size: 7.5pt;
      font-weight: 600;
      text-transform: uppercase;
    }
    .figs {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
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
      font-size: 16pt;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .fig-u {
      margin-left: 0.2rem;
      color: var(--muted);
      font-size: 9pt;
      font-weight: 500;
    }
    .fig.warn .fig-v {
      color: #7a5d17;
    }
    .fig.bad .fig-v {
      color: var(--bad);
    }
    .sec {
      margin-top: 1.15rem;
    }
    .h {
      margin-bottom: 0.3rem;
      font-size: 10.5pt;
      font-weight: 650;
    }
    .scroll {
      overflow-x: auto;
    }
    .t {
      width: 100%;
      min-width: 38rem;
      border-collapse: collapse;
      font-size: 8.6pt;
    }
    .t th,
    .t td {
      padding: 0.28rem 0.45rem;
      text-align: left;
      vertical-align: baseline;
    }
    .t .r {
      text-align: right;
    }
    /* A left-aligned column right after a right-aligned one gets air, so their dashes do not run together. */
    .t .r + :not(.r) {
      padding-left: 1.1rem;
    }
    .t thead th {
      padding-top: 0.35rem;
      padding-bottom: 0.35rem;
      border-bottom: 1.5px solid var(--rule);
      white-space: nowrap;
    }
    .t thead th:first-child,
    .t tbody th,
    .t tfoot th {
      padding-left: 0;
    }
    .t tbody th {
      font-weight: 400;
    }
    .t tbody tr {
      border-bottom: 1px solid #eeece6;
      break-inside: avoid;
    }
    .t tbody tr.off {
      color: var(--muted);
    }
    .t tbody tr.flag th {
      box-shadow: inset 2px 0 0 var(--bad);
      padding-left: 0.35rem;
    }
    .t tfoot tr {
      border-top: 2px solid var(--rule);
      font-weight: 700;
    }
    td.bad {
      color: var(--bad);
      font-weight: 700;
    }
    td.ot {
      color: #7a5d17;
      font-weight: 600;
    }
    .live {
      color: #1d6b38;
      font-weight: 600;
    }
    .st {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      white-space: nowrap;
    }
    .st::before {
      content: '';
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 9999px;
      background: #8e96a6;
    }
    .st[data-s='IN_PROGRESS']::before {
      background: #1f4fa3;
    }
    .st[data-s='COMPLETED']::before {
      background: var(--gold);
    }
    .st[data-s='ISSUE'] {
      color: var(--bad);
      font-weight: 650;
    }
    .st[data-s='ISSUE']::before {
      background: var(--bad);
    }
    .pbar {
      display: block;
      width: 100%;
      min-width: 4rem;
      height: 3px;
      margin-top: 0.2rem;
      border-radius: 2px;
      background: var(--soft);
      overflow: hidden;
    }
    .pbar > span {
      display: block;
      height: 100%;
      background: var(--gold);
    }
    .flagnote {
      margin-top: 0.3rem;
      padding-left: 0.4rem;
      border-left: 2px solid var(--bad);
      color: var(--bad);
      font-size: 7.6pt;
    }
    .none {
      color: var(--muted);
    }
    .none.ok {
      color: #1d6b38;
      font-weight: 600;
    }
    .issues {
      display: grid;
      gap: 0.35rem;
      font-size: 8.8pt;
    }
    .issues li {
      padding: 0.35rem 0.6rem;
      border-left: 3px solid var(--bad);
      background: #fbe5e6;
      break-inside: avoid;
    }
    .log {
      margin-top: 0.1rem;
      font-size: 8.4pt;
    }
    .legend {
      margin-top: 1.1rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7.6pt;
    }
    .sign {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 2rem;
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
    .s-foot {
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
      .s-titleblock {
        text-align: left;
      }
      .meta {
        grid-template-columns: 1fr 1fr;
      }
      .meta > div,
      .meta > div + div {
        padding: 0.45rem 0;
        border-left: 0;
        border-top: 1px solid var(--hair);
      }
      .figs {
        grid-template-columns: 1fr 1fr;
      }
      .fig:nth-child(odd) {
        border-left: 0;
      }
      .fig:nth-child(n + 3) {
        border-top: 1px solid var(--hair);
      }
      .fig:last-child {
        grid-column: 1 / -1;
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
      .scroll {
        overflow: visible;
      }
      .t {
        min-width: 0;
      }
    }
  `,
})
export class ReportComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly org = inject(OrgService);
  private readonly orgLoad = this.org.load();
  protected readonly store = inject(ManagerStore);
  private readonly session = inject(SessionStore);
  private readonly document = inject(DOCUMENT);

  /** `?date=YYYY-MM-DD`, bound by withComponentInputBinding. */
  readonly date = input<string | undefined>(undefined);

  protected readonly Math = Math;
  protected readonly R = R;
  protected readonly hm = hm;
  protected readonly demo = DEMO_MODE;
  protected readonly issues = signal<readonly IssueLine[]>([]);
  protected readonly issuesLoading = signal(false);
  protected readonly generated = signal('');

  protected readonly data = computed(() => {
    const d = this.store.overview();
    return d && d.date === this.store.date() ? d : null;
  });
  /** Present workers first, longest day first; those who did not come stay listed at the end. */
  protected readonly workers = computed(() =>
    [...(this.data()?.workers ?? [])].sort(
      (a, b) =>
        Number(a.presence === 'NOT_STARTED') - Number(b.presence === 'NOT_STARTED') ||
        b.minutesToday - a.minutesToday ||
        a.user.displayName.localeCompare(b.user.displayName),
    ),
  );
  /**
   * Orders that mattered that day. Today: every open order plus completed ones worked on today. Another day:
   * only orders worked on, written to or photographed that day, or planned to start or due that day.
   */
  protected readonly orders = computed(() =>
    [...(this.data()?.orders ?? [])]
      .filter((o) => o.order.published && (this.store.isToday() ? o.order.status !== 'COMPLETED' || o.minutesToday > 0 : o.activeOnDate))
      .sort((a, b) => STATUS_RANK[a.order.status] - STATUS_RANK[b.order.status] || compareCodes(a.order.code, b.order.code)),
  );
  protected readonly totals = computed(() => {
    const ws = this.data()?.workers ?? [];
    const os = this.orders();
    return {
      present: ws.filter((w) => w.presence !== 'NOT_STARTED').length,
      minutes: ws.reduce((s, w) => s + w.minutesToday, 0),
      over: ws.reduce((s, w) => s + Math.max(0, w.minutesToday - R.regularDayMin), 0),
      inProgress: os.filter((o) => o.order.status === 'IN_PROGRESS').length,
      completed: os.filter((o) => o.order.status === 'COMPLETED').length,
      issues: os.filter((o) => o.order.status === 'ISSUE').length,
    };
  });
  protected readonly anyLong = computed(() => (this.data()?.workers ?? []).some((w) => w.minutesToday > R.maxDayMin));
  protected readonly scopeLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    if (this.store.isAdmin()) return this.i18n.t('pdf.scopeAll');
    return d.projects.map((p) => p.name).join(', ') || this.i18n.t('common.none');
  });
  protected readonly preparer = computed(() => this.session.user()?.displayName ?? '');
  protected readonly docNo = computed(() => `DP-${this.store.date().replaceAll('-', '')}`);
  protected readonly cachedAt = computed(() => {
    const at = this.store.savedAt();
    return at ? `${this.i18n.date(at)} ${this.i18n.time(at)}` : '';
  });

  private issueSeq = 0;

  constructor() {
    effect(() => {
      const requested = this.date();
      untracked(() => {
        if (requested && isIsoDate(requested) && requested !== this.store.date()) {
          this.store.setDate(requested);
        } else if (!this.store.overview() || this.store.overview()?.date !== this.store.date()) {
          void this.store.load();
        }
      });
    });
    effect(() => {
      const d = this.data();
      untracked(() => {
        this.generated.set(`${this.i18n.dateShort(Date.now())} ${this.i18n.time(Date.now())}`);
        void this.loadIssues(d?.orders.filter((o) => o.order.status === 'ISSUE') ?? []);
      });
    });
  }

  protected step(n: number): void {
    const next = addDays(this.store.date(), n);
    if (next > toIsoDate()) return;
    this.store.setDate(next as IsoDate);
  }

  protected print(): void {
    this.generated.set(`${this.i18n.dateShort(Date.now())} ${this.i18n.time(Date.now())}`);
    this.document.defaultView?.print();
  }

  protected siteName(siteId: string): string {
    const s = this.data()?.sites.find((x) => x.id === siteId);
    return s ? `${s.projectName} · ${s.name}` : '–';
  }

  protected progress(o: WorkOrder): number {
    return o.plannedQty > 0 ? Math.min(100, (o.doneQty / o.plannedQty) * 100) : 0;
  }

  protected statusKey(status: WorkOrderStatus): TranslationKey {
    return `status.${status}` as TranslationKey;
  }

  protected summaryKey(s: string): TranslationKey {
    return `reports.status${s}` as TranslationKey;
  }

  protected unitKey(unit: string): TranslationKey {
    return `unit.${unit}` as TranslationKey;
  }

  protected crewNames(crew: ReadonlyArray<{ readonly displayName: string }>): string {
    return crew.length ? crew.map((c) => c.displayName).join(', ') : this.i18n.t('mgr.unassigned');
  }

  /** Issue texts live on the order detail; fetch them for the few held orders. Offline, the list still names them. */
  private async loadIssues(rows: ReadonlyArray<{ order: WorkOrder }>): Promise<void> {
    const seq = ++this.issueSeq;
    const base: IssueLine[] = rows.map((r) => ({
      code: r.order.code ?? '',
      title: r.order.title,
      site: this.siteName(r.order.siteId),
      assignee: r.order.crew.length ? r.order.crew.map((c) => c.displayName).join(', ') : null,
      logs: [],
    }));
    this.issues.set(base);
    if (rows.length === 0) return;
    this.issuesLoading.set(true);
    const results = await Promise.allSettled(rows.map((r) => this.store.detail(r.order.id)));
    if (seq !== this.issueSeq) return;
    this.issues.set(
      base.map((line, i) => {
        const res = results[i];
        return res?.status === 'fulfilled' ? { ...line, logs: res.value.logs.filter((l) => l.kind === 'ISSUE') } : line;
      }),
    );
    this.issuesLoading.set(false);
  }
}
