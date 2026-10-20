import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { SyncEngine } from '../../core/sync/sync-engine.service';
import { IconComponent } from './icon.component';

/**
 * Always-visible connection badge with the unsynced counter.
 * The counter carries a dashed stub edge while items wait on the device; it disappears when the server has everything.
 */
@Component({
  selector: 'aon-network-status',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-block',
    '(document:pointerdown)': 'onOutside($event)',
    '(document:keydown.escape)': 'open.set(false)',
    '(window:resize)': 'open.set(false)',
  },
  template: `
    @if (variant() === 'pill' || variant() === 'line') {
      <button
        type="button"
        #trigger
        class="net-pill"
        [class.is-line]="variant() === 'line'"
        [class.on-dark]="variant() === 'line' && onDark()"
        [class.is-offline]="!network.online()"
        [class.is-failed]="sync.failedItems().length > 0"
        [attr.aria-expanded]="open()"
        aria-controls="aon-net-panel"
        [attr.aria-label]="i18n.t('net.badgeLabel', { state: stateLabel(), n: sync.unsyncedCount() })"
        (click)="open.set(!open())"
      >
        @if (!network.online()) {
          <aon-icon name="cloud-off" [size]="16" />
        } @else if (sync.phase() === 'SYNCING') {
          <aon-icon name="refresh" [size]="16" class="animate-spin [animation-duration:1.4s]" />
        } @else {
          <span class="net-dot"></span>
        }
        <span>{{ stateLabel() }} · {{ i18n.t('net.waiting', { n: sync.unsyncedCount() }) }}</span>
      </button>
    } @else {
    <button
      #trigger
      type="button"
      class="flex min-h-12 items-stretch text-left"
      [attr.aria-expanded]="open()"
      aria-controls="aon-net-panel"
      [attr.aria-label]="i18n.t('net.badgeLabel', { state: stateLabel(), n: sync.unsyncedCount() })"
      (click)="open.set(!open())"
    >
      <span
        class="flex items-center gap-2 px-3 label-caps"
        [class]="network.online() ? (onDark() ? 'bg-charcoal-deep text-white' : 'bg-stock text-ink ring-2 ring-inset ring-charcoal') : 'bg-stock text-ink ring-2 ring-inset ring-hold'"
      >
        @if (network.online()) {
          @if (sync.phase() === 'SYNCING') {
            <aon-icon name="refresh" [size]="18" class="animate-spin [animation-duration:1.4s]" />
          } @else {
            <span class="size-2.5 rounded-full bg-done ring-2 ring-white/70"></span>
          }
        } @else {
          <aon-icon name="cloud-off" [size]="18" class="text-hold" />
        }
        <span class="hidden min-[380px]:inline">{{ stateLabel() }}</span>
      </span>
      @if (sync.unsyncedCount() > 0) {
        <span
          class="flex items-center gap-1 border-l-[3px] border-dashed border-charcoal px-3 font-cond text-xl"
          [class]="sync.failedItems().length > 0 ? 'bg-hold text-white' : 'bg-gold text-ink'"
        >
          {{ sync.unsyncedCount() }}
        </span>
      }
    </button>
    }

    <!-- Top layer (popover): no ancestor's clip-path, overflow or z-index can hide it. -->
    <div #panel id="aon-net-panel" popover="manual" role="dialog" class="net-panel" [attr.aria-label]="i18n.t('more.sync')">
      @if (open()) {
        <div class="np-head">
          <p class="np-state" [class.is-off]="!network.online()">
            @if (!network.online()) {
              <aon-icon name="cloud-off" [size]="18" />
            } @else {
              <span class="net-dot"></span>
            }
            {{ stateLabel() }}
          </p>
          <button type="button" class="np-close" [attr.aria-label]="i18n.t('common.close')" (click)="open.set(false)"><aon-icon name="x" [size]="18" /></button>
        </div>
        <p class="np-sub">
          {{ sync.lastSyncAt() ? i18n.t('net.lastSync', { time: i18n.time(sync.lastSyncAt()) }) : i18n.t('net.neverSynced') }}
        </p>
        <dl class="np-figs">
          <div>
            <dt>{{ i18n.t('net.pending', { n: '' }) }}</dt>
            <dd class="num">{{ sync.pendingCount() }}</dd>
          </div>
          <div [class.is-bad]="sync.failedItems().length > 0">
            <dt>{{ i18n.t('net.failed', { n: '' }) }}</dt>
            <dd class="num">{{ sync.failedItems().length }}</dd>
          </div>
        </dl>
        @if (sync.unsyncedCount() === 0) {
          <p class="np-ok"><aon-icon name="circle-check" [size]="18" />{{ i18n.t('net.allSynced') }}</p>
        }
        @if (network.simulatedOffline()) {
          <p class="np-warn">{{ i18n.t('more.simulateOffline') }} · {{ i18n.t('net.simulated') }}</p>
        }
        <button type="button" class="np-sync" [disabled]="!network.online() || sync.phase() === 'SYNCING'" (click)="sync.syncNow()">
          <aon-icon name="refresh" [size]="18" [class.animate-spin]="sync.phase() === 'SYNCING'" />
          {{ i18n.t('net.syncNow') }}
        </button>
      }
    </div>
  `,
  styles: `
    .net-panel {
      position: fixed;
      inset: auto;
      margin: 0;
      max-height: calc(100dvh - 1.5rem);
      overflow-y: auto;
      padding: 1rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.85rem;
      background: #fff;
      color: var(--color-text);
      font-family: var(--font-ui);
      text-align: left;
      white-space: normal;
      box-shadow: 0 18px 40px -14px rgb(20 20 20 / 0.4);
    }
    .np-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .np-state {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.15rem;
      font-weight: 650;
    }
    .np-state.is-off {
      color: var(--color-gold-ink);
    }
    .np-close {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      margin: -0.5rem -0.5rem -0.5rem 0;
      border-radius: 0.5rem;
      color: var(--color-text-muted);
    }
    .np-close:hover {
      background: var(--color-field);
    }
    .np-sub {
      margin-top: 0.15rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    .np-figs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      margin-top: 0.85rem;
    }
    .np-figs > div {
      padding: 0.55rem 0.75rem;
      border: 1px solid var(--color-line);
      border-radius: 0.6rem;
      background: var(--color-field);
    }
    .np-figs > div.is-bad {
      border-color: var(--color-bad);
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .np-figs dt {
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .np-figs dd {
      margin-top: 0.1rem;
      font-size: 1.6rem;
      font-weight: 650;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .np-ok {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-top: 0.75rem;
      color: var(--color-ok);
      font-size: 0.92rem;
      font-weight: 600;
    }
    .np-warn {
      margin-top: 0.75rem;
      color: var(--color-gold-ink);
      font-size: 0.9rem;
      font-weight: 600;
    }
    .np-sync {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      min-height: 3rem;
      margin-top: 0.9rem;
      border-radius: 0.6rem;
      background: var(--color-charcoal);
      color: #fff;
      font-weight: 600;
    }
    .np-sync:disabled {
      opacity: 0.5;
    }
    .net-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.375rem;
      padding: 0 0.95rem;
      border-radius: 0.5rem;
      border: 1px solid var(--color-line-strong);
      background: var(--color-field);
      color: var(--color-text);
      font-family: var(--font-ui);
      font-size: 0.97rem;
      font-weight: 500;
      white-space: nowrap;
      transition: background-color 160ms var(--ease-out-expo);
    }
    /* The field bar's quiet form: the same status, no box; it keeps a glove-sized hit area. */
    .net-pill.is-line {
      min-height: 2.75rem;
      padding: 0 0.4rem;
      border-color: transparent;
      background: transparent;
      font-size: 0.92rem;
    }
    .net-pill.is-line.is-offline {
      background: var(--color-gold-tint);
    }
    /* On the dark field bar: light text, a faint hover; warnings keep their own tint and ink. */
    .net-pill.is-line.on-dark {
      color: #d6d4ce;
    }
    .net-pill.is-line.on-dark:hover {
      background: rgb(255 255 255 / 0.08);
    }
    .net-pill.is-line.on-dark.is-offline {
      background: var(--color-gold-tint);
      color: var(--color-text);
    }
    .net-pill.is-line.on-dark.is-failed {
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .net-pill:hover {
      background: #e6e4df;
    }
    .net-pill.is-offline {
      background: var(--color-gold-tint);
      border-color: var(--color-gold);
    }
    .net-pill.is-failed {
      background: var(--color-bad-tint);
      border-color: var(--color-bad);
      color: var(--color-bad-ink);
    }
    .net-dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 9999px;
      background: var(--color-ok);
    }
  `,
})
export class NetworkStatusComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly sync = inject(SyncEngine);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly onDark = input<boolean>(true);
  readonly align = input<'start' | 'end'>('end');
  readonly placement = input<'top' | 'bottom'>('bottom');
  /** `pill`: rounded status chip; `line`: the same status as quiet text (field bar); `badge`: the legacy square badge. */
  readonly variant = input<'badge' | 'pill' | 'line'>('badge');
  protected readonly open = signal(false);
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    effect(() => {
      const el = this.panel().nativeElement;
      const open = this.open();
      if (open) this.place(el);
      // Browsers without the Popover API (iOS < 17): a fixed panel above everything else.
      if (typeof el.showPopover !== 'function') {
        el.style.display = open ? 'block' : 'none';
        el.style.zIndex = '1000';
        return;
      }
      if (open && !el.matches(':popover-open')) el.showPopover();
      else if (!open && el.matches(':popover-open')) el.hidePopover();
    });
  }

  /** Next to the badge, kept inside the viewport with a 12px gutter; full width less the gutter on a phone. */
  private place(el: HTMLElement): void {
    const btn = this.trigger()?.nativeElement.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const gutter = 12;
    const width = Math.min(320, vw - gutter * 2);
    let left = btn ? (this.align() === 'end' ? btn.right - width : btn.left) : gutter;
    left = Math.max(gutter, Math.min(left, vw - width - gutter));
    el.style.width = `${width}px`;
    el.style.left = `${left}px`;
    // The preferred side, unless the other one has clearly more room (a menu near the top of a phone).
    const above = btn ? btn.top - gutter : 0;
    const below = window.innerHeight - (btn?.bottom ?? 56) - gutter;
    const up = this.placement() === 'top' ? above >= 280 || above > below : below < 280 && above > below;
    if (up && btn) {
      el.style.top = 'auto';
      el.style.bottom = `${window.innerHeight - btn.top + 8}px`;
      el.style.maxHeight = `${above - 8}px`;
    } else {
      el.style.bottom = 'auto';
      el.style.top = `${(btn?.bottom ?? 56) + 8}px`;
      el.style.maxHeight = `${below - 8}px`;
    }
  }

  protected readonly stateLabel = computed(() => {
    if (!this.network.online()) return this.i18n.t('net.offline');
    return this.sync.phase() === 'SYNCING' ? this.i18n.t('net.syncing') : this.i18n.t('net.online');
  });

  protected onOutside(event: PointerEvent): void {
    if (this.open() && event.target instanceof Node && !this.host.nativeElement.contains(event.target)) {
      this.open.set(false);
    }
  }
}
