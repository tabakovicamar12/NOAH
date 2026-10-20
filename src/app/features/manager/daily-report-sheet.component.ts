import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { SummaryDetailResponse } from '../../core/models/api.models';
import type { PhotoCategory } from '../../core/models/domain.models';
import { OrgService } from '../../core/org/org.service';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { hm } from '../../core/worktime/worktime';
import { IconComponent } from '../../shared/ui/icon.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { ManagerStore } from './data/manager-store.service';

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: SummaryDetailResponse };

/**
 * One worker's daily report as an A4 sheet (Dnevno poročilo): worker, project and object, each work order with
 * time, quantity, work done, materials and problems, the photos, and lines to sign. Export is the browser's
 * print-to-PDF, like the site report.
 */
@Component({
  selector: 'aon-daily-report-sheet',
  imports: [RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar no-print">
      <div class="bar-l">
        <a [routerLink]="['/m']" [queryParams]="{ report: id() }" class="back" [attr.aria-label]="i18n.t('common.back')"><aon-icon name="arrow-left" [size]="20" [stroke]="2.2" /></a>
        <div class="min-w-0">
          <h1 class="bar-title">{{ i18n.t('pdf.preview') }}</h1>
          <p class="bar-sub">{{ i18n.t('pdf.hint') }}</p>
        </div>
      </div>
      <button type="button" class="print" [disabled]="state().kind !== 'READY'" (click)="print()"><aon-icon name="printer" [size]="18" />{{ i18n.t('pdf.print') }}</button>
    </div>

    <div class="stage">
      @switch (state().kind) {
        @case ('LOADING') {
          <div class="paper skel" aria-busy="true"><span class="sr-only">{{ i18n.t('common.loading') }}</span></div>
        }
        @case ('ERROR') {
          <p class="banner bad" role="alert"><aon-icon name="alert" [size]="18" />{{ i18n.t('review.loadFailed') }}</p>
        }
        @case ('READY') {
          @if (detail(); as d) {
            @let s = d.summary;
            <article class="paper sheet">
              <header class="s-head">
                <div>
                  <aon-logo [size]="1.15" />
                  @if (org.name(); as name) {
                    <p class="kicker">{{ name }}@if (org.info()?.address; as a) { · {{ a }}}</p>
                  }
                </div>
                <div class="s-titleblock">
                  <h1 class="s-title">{{ i18n.t('day.title') }}</h1>
                  <p class="s-date">{{ i18n.dateLong(s.date) }}</p>
                  <p class="s-no num">{{ docNo() }}</p>
                </div>
              </header>

              <dl class="meta">
                <div><dt>{{ i18n.t('mgr.colWorker') }}</dt><dd class="strong">{{ d.worker.displayName }}</dd></div>
                <div><dt>{{ i18n.t('rec.crew') }}</dt><dd>{{ d.worker.crew || '–' }}</dd></div>
                <div><dt>{{ i18n.t('sheet.projectSite') }}</dt><dd>{{ sites() || '–' }}</dd></div>
                <div>
                  <dt>{{ i18n.t('sheet.status') }}</dt>
                  <dd><span class="pill" [attr.data-s]="s.status">{{ i18n.t(statusKey(s.status)) }}</span></dd>
                </div>
              </dl>
              @if (demo) {
                <p class="demo">{{ i18n.t('common.demo') }}</p>
              }

              <section class="figs">
                <div class="fig"><p class="fig-k">{{ i18n.t('day.arrival') }}</p><p class="fig-v num">{{ s.arrivalAt ? i18n.time(s.arrivalAt) : '–' }}</p></div>
                <div class="fig"><p class="fig-k">{{ i18n.t('day.departure') }}</p><p class="fig-v num">{{ s.departureAt ? i18n.time(s.departureAt) : '–' }}</p></div>
                <div class="fig"><p class="fig-k">{{ i18n.t('day.hours') }}</p><p class="fig-v num">{{ hm(s.shiftMinutes) }}<span class="fig-u">h</span></p></div>
                <div class="fig"><p class="fig-k">{{ i18n.t('sheet.onOrders') }}</p><p class="fig-v num">{{ hm(s.orderMinutes) }}<span class="fig-u">h</span></p></div>
                <div class="fig" [class.bad]="s.issuesReported > 0"><p class="fig-k">{{ i18n.t('drill.issues') }}</p><p class="fig-v num">{{ s.issuesReported }}</p></div>
              </section>
              @if (s.declaredEnd || s.corrections.length) {
                <div class="flags">
                  @if (s.declaredEnd) {
                    <p>{{ i18n.t('review.declaredEnd') }}</p>
                  }
                  @for (c of s.corrections; track $index) {
                    <p>
                      <span class="strong">{{ i18n.t(c.field === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}:</span>
                      <span class="num">{{ i18n.time(c.recordedAt) }} → {{ i18n.time(c.proposedAt) }}</span> · {{ c.reason }}
                    </p>
                  }
                </div>
              }

              <section class="sec">
                <h2 class="h">{{ i18n.t('pdf.orders') }}</h2>
                @if (s.lines.length) {
                  <table class="t">
                    <thead>
                      <tr>
                        <th scope="col" class="c-code">{{ i18n.t('mgr.colCode') }}</th>
                        <th scope="col">{{ i18n.t('mgr.colTitle') }}</th>
                        <th scope="col">{{ i18n.t('mgr.colSite') }}</th>
                        <th scope="col" class="r">{{ i18n.t('day.hours') }}</th>
                        <th scope="col" class="r">{{ i18n.t('sheet.quantity') }}</th>
                      </tr>
                    </thead>
                    @for (l of s.lines; track l.workOrderId) {
                      <tbody class="keep">
                        <tr class="o-row">
                          <td class="num nowrap strong">{{ l.code ?? '–' }}</td>
                          <td class="strong">{{ l.title }}</td>
                          <td>{{ l.siteName }}</td>
                          <td class="r num nowrap">{{ hm(l.minutes) }}</td>
                          <td class="r num nowrap">{{ i18n.number(l.quantity) }} {{ i18n.t(unitKey(l.unit)) }}</td>
                        </tr>
                        <tr class="o-detail">
                          <td></td>
                          <td colspan="4">
                            <div class="d-grid">
                              <div>
                                <p class="lbl">{{ i18n.t('day.workDone') }}</p>
                                <p class="txt">{{ l.workDone || '–' }}</p>
                              </div>
                              <div>
                                <p class="lbl">{{ i18n.t('day.materialsUsed') }}</p>
                                @if (l.materialsUsed.length) {
                                  <ul class="mats">
                                    @for (m of l.materialsUsed; track $index) {
                                      <li><span>{{ m.name }}</span><span class="num nowrap">{{ m.qty !== null ? i18n.number(m.qty) : '' }} {{ m.unit ?? '' }}</span></li>
                                    }
                                  </ul>
                                } @else {
                                  <p class="txt muted">–</p>
                                }
                              </div>
                            </div>
                            @if (l.issues.length) {
                              <p class="lbl">{{ i18n.t('drill.issues') }}</p>
                              <ul class="issues">
                                @for (issue of l.issues; track $index) {
                                  <li>{{ issue }}</li>
                                }
                              </ul>
                            }
                          </td>
                        </tr>
                      </tbody>
                    }
                    <tfoot>
                      <tr>
                        <th scope="row" colspan="3">{{ i18n.t('rec.total') }}</th>
                        <td class="r num">{{ hm(s.orderMinutes) }}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                } @else {
                  <p class="none">{{ i18n.t('common.none') }}</p>
                }
              </section>

              <section class="sec keep">
                <h2 class="h">{{ i18n.t('reports.comment') }}</h2>
                <p class="txt">{{ s.comment || '–' }}</p>
              </section>

              <section class="sec">
                <h2 class="h">{{ i18n.t('day.photos') }} <span class="muted num">· {{ d.photos.length }}</span></h2>
                @if (d.photos.length) {
                  <ul class="photos">
                    @for (p of d.photos; track p.id) {
                      <li class="keep">
                        @if (p.url) {
                          <img [src]="p.url" [alt]="i18n.t(photoKey(p.category))" />
                        }
                        <p>
                          <span class="strong" [class.is-bad]="p.category === 'ISSUE'">{{ i18n.t(photoKey(p.category)) }}</span>
                          <span class="muted num"> · {{ i18n.time(p.createdAt) }}@if (orderCode(p.workOrderId); as code) { · {{ code }}}</span>
                        </p>
                        @if (p.caption) {
                          <p class="muted">{{ p.caption }}</p>
                        }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="none">{{ i18n.t('photo.none') }}</p>
                }
              </section>

              <section class="sec keep">
                <h2 class="h">{{ i18n.t('sheet.review') }}</h2>
                @if (s.reviewedAt) {
                  <p>
                    <span class="pill" [attr.data-s]="s.status">{{ i18n.t(statusKey(s.status)) }}</span>
                    <span> {{ s.reviewerName ?? '' }} · <span class="num">{{ i18n.dateShort(s.reviewedAt) }} {{ i18n.time(s.reviewedAt) }}</span></span>
                  </p>
                  @if (s.reviewerNote) {
                    <p class="txt mt">»{{ s.reviewerNote }}«</p>
                  }
                } @else {
                  <p class="muted">{{ i18n.t('sheet.notReviewed') }}@if (s.submittedAt) { · {{ i18n.t('sheet.submitted') }} <span class="num">{{ i18n.dateShort(s.submittedAt) }} {{ i18n.time(s.submittedAt) }}</span>}</p>
                }
              </section>

              <p class="legend">{{ i18n.t('sheet.legend') }}</p>

              <div class="sign keep">
                <div><span class="line-s"></span><p>{{ i18n.t('mgr.colWorker') }} · {{ d.worker.displayName }}</p></div>
                <div><span class="line-s"></span><p>{{ i18n.t('pdf.signManager') }}@if (s.reviewerName) { · {{ s.reviewerName }}}</p></div>
                <div><span class="line-s"></span><p>{{ i18n.t('rec.signDate') }}</p></div>
              </div>

              <footer class="s-foot">
                <span>{{ i18n.t('day.title') }} · {{ d.worker.displayName }} · {{ i18n.dateShort(s.date) }}</span>
                <span class="num">{{ docNo() }} · {{ i18n.t('rec.generated') }} {{ generated() }}</span>
              </footer>
            </article>
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
    }
    .banner.bad {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .sheet {
      --rule: #1b1b1b;
      --hair: #dcd9d1;
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
    .s-no {
      margin-top: 0.1rem;
      color: var(--muted);
      font-size: 8pt;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .meta {
      display: grid;
      grid-template-columns: 1.3fr 0.8fr 2fr 1.1fr;
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
    .lbl {
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
    .fig.bad .fig-v {
      color: var(--bad);
    }
    .pill {
      display: inline-block;
      padding: 0.05rem 0.5rem;
      border: 1px solid currentColor;
      border-radius: 9999px;
      font-size: 8pt;
      font-weight: 600;
      white-space: nowrap;
    }
    .pill[data-s='APPROVED'] {
      color: #1d6b38;
    }
    .pill[data-s='SUBMITTED'] {
      color: #7a5d17;
    }
    .pill[data-s='RETURNED'] {
      color: var(--bad);
    }
    .flags {
      display: grid;
      gap: 0.2rem;
      margin-top: 0.6rem;
      padding: 0.45rem 0.65rem;
      border-left: 3px solid var(--bad);
      background: #fbe5e6;
      font-size: 8.4pt;
    }
    .is-bad {
      color: var(--bad);
    }
    .mt {
      margin-top: 0.3rem;
    }
    .t {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.8pt;
    }
    .t th,
    .t td {
      padding: 0.3rem 0.5rem;
      text-align: left;
      vertical-align: baseline;
    }
    .t th:first-child,
    .t td:first-child {
      padding-left: 0;
    }
    .t th:last-child,
    .t td:last-child {
      padding-right: 0;
    }
    .t thead th {
      color: var(--muted);
      font-size: 7pt;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      white-space: nowrap;
      border-bottom: 1.5px solid var(--rule);
    }
    .t .r {
      text-align: right;
    }
    .c-code {
      width: 6.5rem;
    }
    .t tbody {
      border-bottom: 1px solid var(--hair);
    }
    .o-row td {
      padding-top: 0.5rem;
    }
    .o-detail td {
      padding-top: 0;
      padding-bottom: 0.6rem;
    }
    .d-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 0.4rem 1.25rem;
    }
    .mats li {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.1rem 0;
      border-bottom: 1px dotted var(--hair);
    }
    .t tfoot th,
    .t tfoot td {
      padding-top: 0.4rem;
      border-top: 2px solid var(--rule);
      font-weight: 700;
    }
    .sec {
      margin-top: 1.15rem;
    }
    .h {
      margin-bottom: 0.35rem;
      font-size: 10.5pt;
      font-weight: 650;
    }
    .line {
      padding: 0.55rem 0;
      border-top: 1px solid var(--hair);
    }
    .line-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.25rem 1rem;
      margin-bottom: 0.2rem;
    }
    .lbl {
      margin-top: 0.35rem;
    }
    .txt {
      white-space: pre-line;
    }
    .issues {
      display: grid;
      gap: 0.25rem;
      margin-top: 0.15rem;
    }
    .issues li {
      padding: 0.3rem 0.55rem;
      border-left: 3px solid var(--bad);
      background: #fbe5e6;
    }
    .none {
      color: var(--muted);
    }
    .photos {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
    }
    .photos img {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border: 1px solid var(--hair);
    }
    .photos p {
      margin-top: 0.15rem;
      font-size: 7.8pt;
    }
    .legend {
      margin-top: 1rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--hair);
      color: var(--muted);
      font-size: 7.6pt;
    }
    .sign {
      display: grid;
      grid-template-columns: 1.4fr 1.4fr 1fr;
      gap: 1.5rem;
      margin-top: 2rem;
    }
    .line-s {
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
      .photos {
        grid-template-columns: 1fr 1fr;
      }
      .d-grid,
      .sign {
        grid-template-columns: 1fr;
      }
      /* The order table becomes a stack: number and title, the object, then time and quantity. */
      .t thead {
        display: none;
      }
      .t,
      .t tbody,
      .t tfoot,
      .t tr,
      .t td,
      .t th {
        display: block;
        padding-left: 0;
        padding-right: 0;
      }
      .t td,
      .t th {
        width: auto;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .sec > .t {
        min-width: 0;
      }
      .t tr.o-row {
        display: flex;
        flex-wrap: wrap;
        column-gap: 0.6rem;
      }
      .t tr.o-row td:nth-child(2) {
        flex: 1 1 0;
      }
      .t tr.o-row td:nth-child(3) {
        flex-basis: 100%;
        padding-top: 0;
        color: var(--muted);
      }
      .t tr.o-row td.r {
        padding-top: 0.1rem;
        text-align: left;
      }
      .t tr.o-row td.r + td.r::before {
        content: '· ';
      }
      .t tr.o-detail td:first-child,
      .t tfoot td:empty {
        display: none;
      }
      .t tfoot tr {
        display: flex;
        justify-content: space-between;
        border-top: 2px solid var(--rule);
      }
      .t tfoot th,
      .t tfoot td {
        border-top: 0;
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
export class DailyReportSheetComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly org = inject(OrgService);
  private readonly store = inject(ManagerStore);
  private readonly document = inject(DOCUMENT);

  /** Route parameter `:id` (the summary id), bound by withComponentInputBinding. */
  readonly id = input.required<string>();

  protected readonly hm = hm;
  protected readonly demo = DEMO_MODE;
  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly generated = signal('');
  protected readonly detail = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });
  /** Older reports have no chosen object; fall back to the objects of the orders worked. */
  protected readonly sites = computed(() => {
    const s = this.detail()?.summary;
    if (!s) return '';
    return s.siteName || [...new Set(s.lines.map((l) => l.siteName).filter(Boolean))].join(', ');
  });
  protected readonly docNo = computed(() => {
    const s = this.detail()?.summary;
    return s ? `DPD-${s.date.replaceAll('-', '')}-${s.userId.slice(-4).toUpperCase()}` : '';
  });

  private seq = 0;

  constructor() {
    void this.org.load();
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  protected print(): void {
    this.stamp();
    this.document.defaultView?.print();
  }

  protected orderCode(workOrderId: string): string | null {
    return this.detail()?.summary.lines.find((l) => l.workOrderId === workOrderId)?.code ?? null;
  }

  protected statusKey(s: string): TranslationKey {
    return `reports.status${s}` as TranslationKey;
  }

  protected unitKey(unit: string): TranslationKey {
    return `unit.${unit}` as TranslationKey;
  }

  protected photoKey(c: PhotoCategory): TranslationKey {
    return `photoCat.${c}` as TranslationKey;
  }

  private stamp(): void {
    this.generated.set(`${this.i18n.dateShort(Date.now())} ${this.i18n.time(Date.now())}`);
  }

  private async load(id: string): Promise<void> {
    const seq = ++this.seq;
    this.state.set({ kind: 'LOADING' });
    try {
      const data = await this.store.summaryDetail(id);
      if (seq !== this.seq) return;
      this.stamp();
      this.state.set({ kind: 'READY', data });
    } catch (err: unknown) {
      console.warn('[AON] daily report load failed', err);
      if (seq === this.seq) this.state.set({ kind: 'ERROR' });
    }
  }
}
