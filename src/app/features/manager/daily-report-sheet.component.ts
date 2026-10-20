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
                    <p class="kicker">{{ name }}</p>
                  }
                </div>
                <div class="s-titleblock">
                  <h1 class="s-title">{{ org.titled(i18n.t('day.title')) }}</h1>
                  <p class="s-date">{{ i18n.dateLong(s.date) }}</p>
                </div>
              </header>

              <dl class="meta">
                <div><dt>{{ i18n.t('mgr.colWorker') }}</dt><dd class="strong">{{ d.worker.displayName }}@if (d.worker.crew) {<span class="muted"> · {{ d.worker.crew }}</span>}</dd></div>
                <div><dt>{{ i18n.t('sheet.projectSite') }}</dt><dd>{{ sites() || '–' }}</dd></div>
                <div><dt>{{ i18n.t('pdf.date') }}</dt><dd class="num">{{ i18n.dateShort(s.date) }}</dd></div>
                <div><dt>{{ i18n.t('rec.docNo') }}</dt><dd class="num">{{ docNo() }}</dd></div>
                <div><dt>{{ i18n.t('sheet.status') }}</dt><dd>{{ i18n.t(statusKey(s.status)) }}</dd></div>
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
              @if (s.declaredEnd) {
                <p class="flagnote">{{ i18n.t('review.declaredEnd') }}</p>
              }
              @for (c of s.corrections; track $index) {
                <p class="flagnote">
                  {{ i18n.t(c.field === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}: {{ i18n.time(c.recordedAt) }} → {{ i18n.time(c.proposedAt) }} · {{ c.reason }}
                </p>
              }

              <section class="sec">
                <h2 class="h">{{ i18n.t('pdf.orders') }}</h2>
                @if (s.lines.length) {
                  @for (l of s.lines; track l.workOrderId) {
                    <div class="line keep">
                      <div class="line-head">
                        <p><span class="strong num">{{ l.code ?? '–' }}</span> · {{ l.title }}<span class="muted"> · {{ l.siteName }}</span></p>
                        <p class="num nowrap">{{ hm(l.minutes) }} h · {{ i18n.number(l.quantity) }} {{ i18n.t(unitKey(l.unit)) }}</p>
                      </div>
                      <p class="lbl">{{ i18n.t('day.workDone') }}</p>
                      <p class="txt">{{ l.workDone || '–' }}</p>
                      @if (l.materialsUsed.length) {
                        <p class="lbl">{{ i18n.t('day.materialsUsed') }}</p>
                        <p class="txt">
                          @for (m of l.materialsUsed; track $index; let last = $last) {
                            {{ m.name }}@if (m.qty !== null) { {{ i18n.number(m.qty) }} {{ m.unit ?? '' }}}@if (!last) {, }
                          }
                        </p>
                      }
                      @if (l.issues.length) {
                        <p class="lbl">{{ i18n.t('drill.issues') }}</p>
                        <ul class="issues">
                          @for (issue of l.issues; track $index) {
                            <li>{{ issue }}</li>
                          }
                        </ul>
                      }
                    </div>
                  }
                } @else {
                  <p class="none">{{ i18n.t('common.none') }}</p>
                }
              </section>

              <section class="sec keep">
                <h2 class="h">{{ i18n.t('reports.comment') }}</h2>
                <p class="txt">{{ s.comment || '–' }}</p>
              </section>

              <section class="sec">
                <h2 class="h">{{ i18n.t('day.photos') }} <span class="muted num">({{ d.photos.length }})</span></h2>
                @if (d.photos.length) {
                  <ul class="photos">
                    @for (p of d.photos; track p.id) {
                      <li class="keep">
                        @if (p.url) {
                          <img [src]="p.url" [alt]="i18n.t(photoKey(p.category))" />
                        }
                        <p><span class="strong">{{ i18n.t(photoKey(p.category)) }}</span> · <span class="num">{{ i18n.time(p.createdAt) }}</span>@if (orderCode(p.workOrderId); as code) {<span class="muted"> · {{ code }}</span>}</p>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="none">{{ i18n.t('photo.none') }}</p>
                }
              </section>

              @if (s.reviewedAt) {
                <p class="legend">{{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.dateShort(s.reviewedAt) + ' ' + i18n.time(s.reviewedAt) }) }}@if (s.reviewerNote) { · »{{ s.reviewerNote }}«}</p>
              }
              <p class="legend">{{ i18n.t('sheet.legend') }}</p>

              <div class="sign keep">
                <div><span class="line-s"></span><p>{{ i18n.t('mgr.colWorker') }}</p></div>
                <div><span class="line-s"></span><p>{{ i18n.t('pdf.signManager') }}</p></div>
              </div>

              <footer class="s-foot">
                <span>{{ org.titled(i18n.t('day.title')) }} · {{ d.worker.displayName }} · {{ i18n.dateShort(s.date) }}</span>
                <span class="num">{{ i18n.t('rec.generated') }} {{ generated() }}</span>
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
    .meta {
      display: grid;
      grid-template-columns: 1.3fr 1.8fr 0.9fr 1fr 1fr;
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
    .flagnote {
      margin-top: 0.4rem;
      padding-left: 0.4rem;
      border-left: 2px solid var(--bad);
      color: var(--bad);
      font-size: 8pt;
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
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
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
