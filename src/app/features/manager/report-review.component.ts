import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { SummaryDetailResponse } from '../../core/models/api.models';
import type { PhotoCategory, QuantityUnit } from '../../core/models/domain.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ToastService } from '../../core/ui/toast.service';
import { formatDuration } from '../../core/util/util';
import { IconComponent } from '../../shared/ui/icon.component';
import { ReportStatusComponent } from '../../shared/ui/report-status.component';
import { ManagerStore } from './data/manager-store.service';

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: SummaryDetailResponse };

/**
 * One worker's daily report, read like the signed paper it replaces, with the manager's decision at
 * its foot. Returning it requires a note, so the worker always knows what to fix.
 */
@Component({
  selector: 'aon-report-review',
  imports: [NgTemplateOutlet, RouterLink, IconComponent, ReportStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-stock px-5 py-3">
      <h2 id="drill-title" class="min-w-0 truncate text-[1.25rem] font-semibold">{{ i18n.t('review.title', { name: detail()?.worker?.displayName ?? '' }) }}</h2>
      <button type="button" class="-mr-2 grid size-12 shrink-0 place-items-center hover:bg-ground" [attr.aria-label]="i18n.t('common.close')" (click)="closed.emit()">
        <aon-icon name="x" [size]="22" [stroke]="1.7" />
      </button>
    </div>

    @switch (state().kind) {
      @case ('LOADING') {
        <div class="grid gap-3 p-5" aria-busy="true">
          <div class="h-24 animate-pulse rounded-lg bg-[var(--color-track)]"></div>
          <div class="h-40 animate-pulse rounded-lg bg-[var(--color-track)]"></div>
          <span class="sr-only">{{ i18n.t('common.loading') }}</span>
        </div>
      }
      @case ('ERROR') {
        <div class="p-5">
          <p class="rv-flag is-bad" role="alert">
            <aon-icon name="alert" [size]="16" />{{ i18n.t('review.loadFailed') }}
          </p>
          <button type="button" class="rv-btn is-back mt-3" (click)="reload()">
            <aon-icon name="retry" [size]="16" />{{ i18n.t('common.retry') }}
          </button>
        </div>
      }
      @case ('READY') {
        @if (detail(); as d) {
          @let s = d.summary;
          <div class="rv2">
            <div class="rv2-meta">
              <p><b>{{ i18n.dateLong(s.date) }}</b>@if (d.worker.crew) {<span> · {{ d.worker.crew }}</span>}@if (s.siteName) {<span> · {{ s.siteName }}</span>}</p>
              <aon-report-status [status]="s.status" />
            </div>
            <a class="rv-btn is-back w-fit" [routerLink]="['/m/reports', s.id]">
              <aon-icon name="printer" [size]="16" />{{ i18n.t('pdf.print') }}
            </a>

            <ol class="rv2-tl" [attr.aria-label]="i18n.t('day.title')">
              <li class="rv2-stop">
                <span class="rv2-node"></span>
                <span class="rv2-time">{{ i18n.time(s.arrivalAt) }}</span>
                <span class="rv2-label">{{ i18n.t('day.arrival') }}</span>
              </li>
              @for (l of s.lines; track l.workOrderId) {
                <li class="rv2-block" [class.has-issue]="l.issues.length > 0">
                  <span class="rv2-node is-work"></span>
                  <div class="rv2-card">
                    <div class="rv2-head">
                      <p class="min-w-0">
                        <span class="rv-code">{{ l.code }}</span>
                        <span class="rv2-title">{{ l.title }}</span>
                        <span class="rv2-site">{{ l.siteName }}</span>
                      </p>
                      <p class="rv2-fig"><b>{{ duration(l.minutes) }}</b><small>{{ i18n.number(l.quantity) }} {{ i18n.t(unitKey(l.unit)) }}</small></p>
                    </div>
                    <div class="rv2-bar" aria-hidden="true"><span [style.width.%]="share(l.minutes, s.shiftMinutes)"></span></div>
                    <ng-container *ngTemplateOutlet="lineBody; context: { $implicit: l }" />
                  </div>
                </li>
              }
              <li class="rv2-stop">
                <span class="rv2-node"></span>
                <span class="rv2-time">{{ i18n.time(s.departureAt) }}</span>
                <span class="rv2-label">{{ i18n.t('day.departure') }} · <b>{{ duration(s.shiftMinutes) }}</b></span>
              </li>
            </ol>

            <ng-container *ngTemplateOutlet="flags; context: { $implicit: s }" />

            <section>
              <h3 class="rv-h">{{ i18n.t('reports.comment') }}</h3>
              <p class="rv-text">{{ s.comment || i18n.t('common.none') }}</p>
            </section>

            <ng-container *ngTemplateOutlet="photos; context: { $implicit: d }" />
            <ng-container *ngTemplateOutlet="decision; context: { $implicit: s }" />
          </div>
        }
      }
    }

    <ng-template #flags let-s>
      @if (s.declaredEnd || s.corrections.length) {
        <section class="rv-flags" [attr.aria-label]="i18n.t('review.timeFlags')">
          @if (s.declaredEnd) {
            <p class="rv-flag is-bad"><aon-icon name="clock" [size]="15" />{{ i18n.t('review.declaredEnd') }}</p>
          }
          @for (c of s.corrections; track $index) {
            <div class="rv-flag">
              <p>
                <b>{{ i18n.t(c.field === 'ARRIVAL' ? 'day.arrival' : 'day.departure') }}</b>
                <span class="tabular-nums">{{ i18n.time(c.recordedAt) }} → {{ i18n.time(c.proposedAt) }}</span>
              </p>
              <p class="rv-muted">{{ c.reason }}</p>
            </div>
          }
          <p class="rv-note">{{ i18n.t('review.correctionNote') }}</p>
        </section>
      }
    </ng-template>

    <ng-template #lineBody let-l>
      <div class="rv-body">
        @for (issue of l.issues; track $index) {
          <p class="rv-issue"><aon-icon name="alert" [size]="14" />{{ issue }}</p>
        }
        <p class="rv-label">{{ i18n.t('day.workDone') }}</p>
        <p class="rv-text">{{ l.workDone || i18n.t('common.none') }}</p>
        @if (l.materialsUsed.length) {
          <p class="rv-label">{{ i18n.t('day.materialsUsed') }}</p>
          <ul class="rv-mats">
            @for (m of l.materialsUsed; track $index) {
              <li><span>{{ m.name }}</span><b>{{ m.qty !== null ? i18n.number(m.qty) : '' }} {{ m.unit ?? '' }}</b></li>
            }
          </ul>
        }
      </div>
    </ng-template>

    <ng-template #photos let-d>
      <section>
        <h3 class="rv-h">{{ i18n.t('day.photos') }}<small>{{ d.photos.length }}</small></h3>
        @if (d.photos.length) {
          <ul class="rv-photos">
            @for (p of d.photos; track p.id) {
              <li>
                @if (p.url) {
                  <img [src]="p.url" [alt]="i18n.t('photo.alt', { category: i18n.t(photoKey(p.category)), code: '' })" loading="lazy" />
                }
                <span [class.is-bad]="p.category === 'ISSUE'">{{ i18n.t(photoKey(p.category)) }} · {{ i18n.time(p.createdAt) }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="rv-muted rv-small">{{ i18n.t('photo.none') }}</p>
        }
      </section>
    </ng-template>

    <ng-template #decision let-s>
      @if (s.status === 'SUBMITTED' && !canApprove()) {
        <p class="rv-flag"><aon-icon name="lock" [size]="15" />{{ i18n.t('review.foremanCannotApprove') }}</p>
      } @else if (s.status === 'SUBMITTED') {
        <section class="rv-decide" [attr.aria-label]="i18n.t('review.decide')">
          <h3 class="rv-h">{{ i18n.t('review.decide') }}</h3>
          @if (!network.online()) {
            <p class="rv-flag is-bad"><aon-icon name="cloud-off" [size]="15" />{{ i18n.t('review.needsNetwork') }}</p>
          }
          <label class="block">
            <span class="rv-label">{{ i18n.t('review.noteLabel') }}</span>
            <textarea
              rows="2"
              maxlength="1000"
              class="rv-field"
              [class.is-bad]="noteMissing()"
              [placeholder]="i18n.t('reports.notePlaceholder')"
              [value]="note()"
              (input)="note.set($any($event.target).value); noteMissing.set(false)"
            ></textarea>
            @if (noteMissing()) {
              <span class="rv-req" role="alert">{{ i18n.t('review.noteRequired') }}</span>
            }
          </label>
          <div class="rv-actions">
            <button type="button" class="rv-btn is-back" [disabled]="busy() || !network.online()" (click)="decide('RETURNED')">
              <aon-icon name="retry" [size]="16" />{{ i18n.t('reports.return') }}
            </button>
            <button type="button" class="rv-btn is-ok" [disabled]="busy() || !network.online()" (click)="decide('APPROVED')">
              <aon-icon name="check" [size]="16" [stroke]="2.25" />{{ i18n.t('reports.approve') }}
            </button>
          </div>
        </section>
      } @else if (s.reviewedAt) {
        <p class="rv-done" [class.is-ok]="s.status === 'APPROVED'">
          <aon-icon [name]="s.status === 'APPROVED' ? 'circle-check' : 'retry'" [size]="17" />
          <span>
            {{ i18n.t('day.reviewedBy', { name: s.reviewerName ?? '', time: i18n.time(s.reviewedAt) }) }}
            @if (s.reviewerNote) {
              <span class="rv-muted"> · »{{ s.reviewerNote }}«</span>
            }
          </span>
        </p>
      }
    </ng-template>
  `,
  styles: `
    /* ---- Shared parts of the review panel ---- */
    .rv-h {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      font-size: 1rem;
      font-weight: 600;
    }
    .rv-h small {
      color: var(--color-text-muted);
      font-size: 0.875rem;
      font-weight: 400;
    }
    .rv-muted {
      color: var(--color-text-muted);
    }
    .rv-small {
      font-size: 0.9rem;
    }
    .rv-code {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.85rem;
      letter-spacing: -0.01em;
    }
    .rv-label {
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .rv-text {
      white-space: pre-line;
      line-height: 1.45;
    }
    .rv-flags {
      display: grid;
      gap: 0.4rem;
    }
    .rv-flag {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      padding: 0.55rem 0.7rem;
      border: 1px dashed rgb(193 160 80 / 0.7);
      border-radius: 0.5rem;
      background: var(--color-gold-fill);
      font-size: 0.9rem;
    }
    .rv-flag p:first-child {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .rv-flag.is-bad {
      flex-direction: row;
      align-items: center;
      gap: 0.4rem;
      border-color: #ef9a9a;
      background: #fdeced;
      color: var(--color-bad-ink);
    }
    .rv-note {
      color: var(--color-text-muted);
      font-size: 0.8rem;
    }
    .rv-body {
      display: grid;
      gap: 0.3rem;
    }
    .rv-issue {
      display: flex;
      align-items: flex-start;
      gap: 0.35rem;
      padding: 0.4rem 0.55rem;
      border-radius: 0.45rem;
      background: #fdeced;
      color: var(--color-bad-ink);
      font-size: 0.9rem;
      line-height: 1.35;
    }
    .rv-issue aon-icon {
      flex: 0 0 auto;
      margin-top: 0.15rem;
    }
    .rv-mats > li {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.3rem 0;
      border-bottom: 1px solid var(--color-line);
      font-size: 0.93rem;
    }
    .rv-mats b {
      font-weight: 600;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .rv-photos {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.4rem;
      margin-top: 0.5rem;
    }
    .rv-photos li {
      position: relative;
      overflow: hidden;
      border-radius: 0.45rem;
      background: var(--color-track);
      aspect-ratio: 1;
    }
    .rv-photos img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .rv-photos span {
      position: absolute;
      inset: auto 0 0;
      padding: 0.15rem 0.35rem;
      background: rgb(30 30 30 / 0.7);
      color: #fff;
      font-size: 0.68rem;
      font-weight: 600;
    }
    .rv-photos span.is-bad {
      background: rgb(200 21 29 / 0.85);
    }
    .rv-decide {
      display: grid;
      gap: 0.6rem;
    }
    .rv-field {
      display: block;
      width: 100%;
      margin-top: 0.25rem;
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: #fff;
      font-size: 0.95rem;
      line-height: 1.4;
      outline: none;
      resize: vertical;
    }
    .rv-field:focus-visible {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25);
    }
    .rv-field.is-bad {
      border-color: #e7a3a3;
    }
    .rv-req {
      display: block;
      margin-top: 0.25rem;
      color: var(--color-bad);
      font-size: 0.85rem;
      font-weight: 600;
    }
    .rv-actions {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.5rem;
    }
    .rv-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      min-height: 2.75rem;
      border-radius: 0.5rem;
      font-weight: 600;
      transition: filter 160ms var(--ease-out-expo), transform 120ms var(--ease-out-expo);
    }
    .rv-btn:active:not(:disabled) {
      transform: translateY(1px);
    }
    .rv-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .rv-btn.is-ok {
      background: var(--color-gold);
      color: var(--color-charcoal);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12), inset 0 -2px 0 rgb(0 0 0 / 0.08);
    }
    .rv-btn.is-ok:hover:not(:disabled) {
      filter: brightness(1.04);
    }
    .rv-btn.is-back {
      padding: 0 0.8rem;
      white-space: nowrap;
      border: 1px solid var(--color-line-strong);
      background: #fff;
      color: var(--color-bad);
    }
    .rv-done {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.6rem 0.75rem;
      border-radius: 0.5rem;
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
      font-size: 0.93rem;
    }
    .rv-done.is-ok {
      background: var(--color-ok-tint);
      color: var(--color-ok-ink);
    }
    .rv-done aon-icon {
      flex: 0 0 auto;
      margin-top: 0.1rem;
    }

    /* ---- V2: the day as a timeline ---- */
    .rv2 {
      display: grid;
      gap: 1.25rem;
      padding: 1rem 1.25rem 1.5rem;
    }
    .rv2-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .rv2-meta b {
      font-weight: 600;
    }
    .rv2-meta span {
      color: var(--color-text-muted);
    }
    .rv2-tl {
      position: relative;
      display: grid;
      gap: 0.75rem;
      padding-left: 1.4rem;
    }
    .rv2-tl::before {
      content: '';
      position: absolute;
      top: 0.6rem;
      bottom: 0.6rem;
      left: 0.35rem;
      width: 2px;
      background: var(--color-track);
    }
    .rv2-stop,
    .rv2-block {
      position: relative;
    }
    .rv2-node {
      position: absolute;
      top: 0.35rem;
      left: -1.4rem;
      width: 0.8rem;
      height: 0.8rem;
      border: 2px solid var(--color-panel);
      border-radius: 9999px;
      background: var(--color-rail);
      box-shadow: 0 0 0 1px var(--color-line-strong);
    }
    .rv2-node.is-work {
      top: 0.9rem;
      background: var(--color-gold);
    }
    .rv2-block.has-issue .rv2-node {
      background: var(--color-bad);
    }
    .rv2-stop {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
    }
    .rv2-time {
      font-size: 1.2rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .rv2-label {
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    .rv2-label b {
      color: var(--color-gold-ink);
      font-weight: 600;
    }
    .rv2-card {
      display: grid;
      gap: 0.5rem;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--color-line);
      border-radius: 0.6rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04);
    }
    .rv2-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.6rem;
    }
    .rv2-title {
      display: block;
      font-weight: 600;
      line-height: 1.3;
    }
    .rv2-site {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .rv2-fig {
      flex: 0 0 auto;
      text-align: right;
    }
    .rv2-fig b {
      display: block;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .rv2-fig small {
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .rv2-bar {
      height: 0.35rem;
      overflow: hidden;
      border-radius: 9999px;
      background: var(--color-track);
    }
    .rv2-bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--color-progress);
    }

  `,
})
export class ReportReviewComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly network = inject(NetworkStatusService);
  private readonly store = inject(ManagerStore);
  /** A foreman sees the report but a manager signs it off: who records the work does not approve it. */
  protected readonly canApprove = this.store.canApprove;
  private readonly toast = inject(ToastService);

  readonly summaryId = input.required<string>();
  readonly closed = output<void>();

  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly note = signal('');
  protected readonly noteMissing = signal(false);
  protected readonly busy = signal(false);
  private seq = 0;

  protected readonly detail = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s.data : null;
  });

  constructor() {
    // Track only the id: fetch() reads `state`, which would otherwise re-run this effect after every load.
    effect(() => {
      const id = this.summaryId();
      untracked(() => void this.fetch(id));
    });
  }

  protected duration(minutes: number): string {
    return formatDuration(minutes);
  }


  /** An order's share of the shift, for the timeline bar. */
  protected share(minutes: number, total: number): number {
    return total > 0 ? Math.min(100, (minutes / total) * 100) : 0;
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected photoKey(c: PhotoCategory): `photoCat.${PhotoCategory}` {
    return `photoCat.${c}`;
  }

  protected reload(): void {
    void this.fetch(this.summaryId());
  }

  protected async decide(decision: 'APPROVED' | 'RETURNED'): Promise<void> {
    const note = this.note().trim();
    if (decision === 'RETURNED' && !note) {
      this.noteMissing.set(true);
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.store.review(this.summaryId(), { decision, note: note || null });
      this.toast.success(this.i18n.t(decision === 'APPROVED' ? 'reports.approvedToast' : 'reports.returnedToast'));
      this.note.set('');
      await this.fetch(this.summaryId());
    } catch (err: unknown) {
      console.warn('[AON] review failed', err);
      this.toast.error(this.i18n.t('reports.reviewFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  private async fetch(id: string): Promise<void> {
    const seq = ++this.seq;
    if (this.detail()?.summary.id !== id) this.state.set({ kind: 'LOADING' });
    try {
      const data = await this.store.summaryDetail(id);
      if (seq === this.seq) this.state.set({ kind: 'READY', data });
    } catch (err: unknown) {
      console.warn('[AON] report detail failed', err);
      if (seq === this.seq) this.state.set({ kind: 'ERROR' });
    }
  }
}
