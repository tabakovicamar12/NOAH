import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { ToastService } from '../../core/ui/toast.service';
import { formatDuration } from '../../core/util/util';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { NetworkStatusComponent } from '../../shared/ui/network-status.component';
import { SitePickerComponent } from './site-picker.component';
import { initialsOf } from '../manager/person';
import { WorkerStore } from './data/worker-store.service';
import { startedMessage, workflowMessage } from './data/workflow-messages';

interface Tab {
  readonly path: string;
  readonly label: TranslationKey;
  readonly icon: IconName;
  readonly exact: boolean;
}

/**
 * Field shell: a dark bar with the gold wordmark, the connection line and the worker's initials, and a
 * floating dark pill in the thumb zone with the shift button in its middle. Starting and ending the shift
 * is held for a moment, so a gloved brush cannot do it by accident.
 */
@Component({
  selector: 'aon-worker-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, NetworkStatusComponent, SitePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mgr-ui wkr-ui block' },
  template: `
    <a href="#worker-main" class="skip">{{ i18n.t('common.skipToContent') }}</a>
    <div class="frame">
      <header class="top no-print">
        <span class="mark">AON</span>
        <aon-network-status variant="line" [onDark]="true" />
        <a routerLink="/w/more" class="who" [attr.aria-label]="i18n.t('worker.tabMore') + ' · ' + (session.user()?.displayName ?? '')">{{ initials() }}</a>
      </header>

      <main id="worker-main" tabindex="-1" class="main">
        <router-outlet />
      </main>

      <nav class="dock no-print" [attr.aria-label]="i18n.t('worker.mainNav')">
        @for (tab of tabs; track tab.path; let i = $index) {
          @if (i === 2) {
            <span class="mid" [attr.data-burst]="burst()">
              <button
                type="button"
                class="shift"
                [class.is-end]="shiftMode() === 'end'"
                [class.is-stale]="shiftMode() === 'stale'"
                [class.is-closed]="shiftMode() === 'closed'"
                [class.is-idle]="hold() === 0"
                [style.--p]="hold()"
                [disabled]="busy()"
                [attr.aria-label]="shiftAria()"
                (pointerdown)="holdDown($event)"
                (pointerup)="holdUp()"
                (pointerleave)="holdCancel()"
                (pointercancel)="holdCancel()"
                (keydown)="holdKeyDown($event)"
                (keyup)="holdKeyUp($event)"
                (blur)="holdCancel()"
                (contextmenu)="$event.preventDefault()"
              >
                <span class="ring" aria-hidden="true"></span>
                <span class="face" aria-hidden="true">
                  @if (shiftMode() === 'end') {
                    <aon-icon name="stop" [size]="20" [stroke]="2.6" />
                  } @else if (shiftMode() === 'closed') {
                    <aon-icon name="lock" [size]="20" [stroke]="2.2" />
                  } @else if (shiftMode() === 'stale') {
                    <aon-icon name="clock" [size]="22" [stroke]="2.2" />
                  } @else {
                    <aon-icon name="play" [size]="22" [stroke]="2.6" />
                  }
                </span>
              </button>
            </span>
          }
          <a
            [routerLink]="tab.path"
            routerLinkActive="is-active"
            [routerLinkActiveOptions]="{ exact: tab.exact }"
            #rla="routerLinkActive"
            [attr.aria-current]="rla.isActive ? 'page' : null"
            class="tab"
          >
            <aon-icon [name]="tab.icon" [size]="22" [stroke]="1.9" />
            <span>{{ i18n.t(tab.label) }}</span>
          </a>
        }
      </nav>
    </div>
    @if (store.sitePickerOpen()) {
      <aon-site-picker />
    }
  `,
  styles: `
    :host {
      font-family: var(--font-ui);
      color: var(--color-text);
      background: var(--color-site);
    }
    .skip {
      position: absolute;
      left: -999px;
      z-index: 80;
      padding: 0.75rem 1rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 600;
    }
    .skip:focus {
      left: 0.5rem;
      top: 0.5rem;
    }
    .frame {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      max-width: 36rem;
      margin: 0 auto;
      background: var(--color-site);
    }
    .top {
      position: sticky;
      top: 0;
      z-index: 40;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 3.35rem;
      padding: calc(env(safe-area-inset-top) + 0.35rem) 0.9rem 0.35rem;
      background: var(--color-rail);
      color: #ecebe7;
      /* the bar runs the full width of a wide screen while its content stays in the frame */
      box-shadow: 0 0 0 100vmax var(--color-rail);
      clip-path: inset(0 -100vmax);
    }
    .mark {
      color: var(--color-gold);
      font-size: 1.6rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .who {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 9999px;
      background: #3a3936;
      color: #ecebe7;
      font-size: 0.95rem;
      font-weight: 600;
      text-decoration: none;
    }
    .who:focus-visible {
      outline: 2px solid var(--color-gold);
      outline-offset: 2px;
    }
    .main {
      flex: 1 1 auto;
      outline: none;
    }
    /* The floating pill: four places and the shift button in the middle, under the thumb. */
    .dock {
      position: sticky;
      bottom: calc(env(safe-area-inset-bottom) + 0.85rem);
      z-index: 40;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 4.6rem minmax(0, 1fr) minmax(0, 1fr);
      align-items: center;
      width: calc(100% - 1.75rem);
      max-width: 30rem;
      height: 4.5rem;
      margin: 0.85rem auto calc(env(safe-area-inset-bottom) + 0.85rem);
      padding: 0 0.35rem;
      border-radius: 9999px;
      background: var(--color-rail);
      box-shadow: 0 18px 30px -16px rgb(20 20 20 / 0.7);
    }
    .tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.15rem;
      height: 3.75rem;
      border-radius: 9999px;
      color: #a8a6a0;
      font-size: 0.72rem;
      font-weight: 500;
      text-decoration: none;
    }
    .tab {
      transition: color 160ms var(--ease-out-expo);
    }
    .tab.is-active {
      color: var(--color-gold);
      font-weight: 700;
    }
    .tab:focus-visible,
    .shift:focus-visible {
      outline: 2px solid var(--color-gold);
      outline-offset: 2px;
      box-shadow: none;
    }
    .mid {
      position: relative;
      display: grid;
      place-items: center;
    }
    /* Confirmed: a wave leaves the button, gold when the day starts, white when it ends. */
    .mid[data-burst]::before,
    .mid[data-burst]::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 3.9rem;
      height: 3.9rem;
      margin: -1.95rem 0 0 -1.95rem;
      border-radius: 9999px;
      border: 2px solid var(--color-gold);
      pointer-events: none;
      animation: wave 760ms linear forwards;
    }
    .mid[data-burst]::after {
      animation-delay: 110ms;
      opacity: 0;
    }
    .mid[data-burst='end']::before,
    .mid[data-burst='end']::after {
      border-color: #fff;
    }
    @keyframes wave {
      0% { transform: scale(1); opacity: 0.95; }
      25% { transform: scale(1.7); opacity: 0.7; }
      55% { transform: scale(2.1); opacity: 0.3; }
      100% { transform: scale(2.3); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes wave {
        0% { transform: scale(1.15); opacity: 0.8; }
        100% { transform: scale(1.15); opacity: 0; }
      }
    }
    /* Hold to confirm: a gold ring closes around the button while it is held. */
    .shift {
      position: relative;
      display: grid;
      place-items: center;
      width: 3.9rem;
      height: 3.9rem;
      border-radius: 9999px;
      background: none;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      transition: transform 150ms var(--ease-out-expo);
    }
    .shift:active:not(:disabled) {
      transform: scale(0.96);
    }
    /* Let go early: the ring runs back instead of vanishing. */
    .shift.is-idle {
      transition: --p 260ms cubic-bezier(0.16, 1, 0.3, 1), transform 150ms var(--ease-out-expo);
    }
    .shift:disabled {
      opacity: 0.6;
    }
    @property --p {
      syntax: '<number>';
      inherits: true;
      initial-value: 0;
    }
    .ring {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: conic-gradient(var(--color-gold) calc(var(--p, 0) * 360deg), rgb(255 255 255 / 0.14) 0);
    }
    .face {
      position: relative;
      display: grid;
      place-items: center;
      width: 3.1rem;
      height: 3.1rem;
      border-radius: 9999px;
      background: var(--color-gold);
      color: var(--color-charcoal);
      box-shadow: 0 0 0 2px var(--color-rail);
    }
    .face aon-icon {
      margin-left: 0.15rem;
    }
    .is-end .face {
      background: #fff;
    }
    .is-end .face aon-icon,
    .is-stale .face aon-icon {
      margin-left: 0;
    }
    .is-closed .face {
      background: #4a4845;
      color: #d6d4ce;
    }
    .is-closed .face aon-icon {
      margin-left: 0;
    }
    .is-stale .face {
      background: #fdeced;
      color: var(--color-bad-ink);
    }
    @media (min-width: 700px) {
      .frame {
        max-width: 46rem;
      }
    }
    @media (orientation: landscape) and (min-width: 640px) and (max-height: 520px) {
      .frame {
        max-width: none;
      }
      .dock {
        height: 3.9rem;
        margin-top: 0.5rem;
      }
      .tab {
        flex-direction: row;
        gap: 0.4rem;
        font-size: 0.8rem;
      }
    }
    @media (min-width: 900px) {
      .frame {
        max-width: 72rem;
      }
      .top {
        padding-inline: 1.5rem;
      }
      .dock {
        max-width: 34rem;
      }
    }
  `,
})
export class WorkerShellComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly session = inject(SessionStore);
  private readonly store = inject(WorkerStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly tabs: readonly Tab[] = [
    { path: '/w/orders', label: 'worker.tabOrders', icon: 'clipboard', exact: false },
    { path: '/w/day', label: 'worker.tabDay', icon: 'file', exact: true },
    { path: '/w/hours', label: 'worker.tabHours', icon: 'clock', exact: true },
    { path: '/w/more', label: 'worker.tabMore', icon: 'menu', exact: true },
  ];

  protected readonly initials = computed(() => initialsOf(this.session.user()?.displayName ?? ''));

  // ---- the shift button
  protected readonly busy = signal(false);
  /** 0 at rest, 1 when the hold is complete. */
  protected readonly hold = signal(0);
  /** Set for one wave after the shift starts or ends. */
  protected readonly burst = signal<'start' | 'end' | null>(null);
  private burstTimer: ReturnType<typeof setTimeout> | undefined;
  /** A shift left open from an earlier day is declared on the home screen, never ended with a press. */
  protected readonly shiftMode = computed((): 'stale' | 'closed' | 'end' | 'start' => {
    if (this.store.staleShift()) return 'stale';
    if (!this.store.openShift() && this.store.dayClosed()) return 'closed';
    return this.store.openShift() ? 'end' : 'start';
  });
  protected readonly shiftAria = computed(() => {
    const mode = this.shiftMode();
    if (mode === 'stale') return this.i18n.t('nav.staleTip');
    if (mode === 'closed') return this.i18n.t('day.closedBlock');
    const label = this.i18n.t(mode === 'end' ? 'shift.end' : this.store.lastEndedShift() ? 'shift.startAgain' : 'shift.start');
    return this.i18n.t('shift.holdAria', { label });
  });
  private frame: number | null = null;
  private keyHeld = false;
  private holdStarted = 0;
  private readonly holdMs = 900;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopFrame();
      clearTimeout(this.burstTimer);
    });
  }

  ngOnInit(): void {
    void this.store.refreshFromServer();
  }

  protected holdDown(e: PointerEvent): void {
    if (this.busy() || e.button !== 0) return;
    if (this.shiftMode() === 'stale') {
      this.toStale();
      return;
    }
    if (this.shiftMode() === 'closed') {
      this.toast.show(this.i18n.t('day.closedBlock'));
      return;
    }
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    this.startHold();
  }

  protected holdUp(): void {
    // Let go long before the ring closed: say how it works instead of doing nothing.
    if (this.frame !== null && performance.now() - this.holdStarted < 350) this.toast.show(this.i18n.t('nav.holdTip'));
    this.holdCancel();
  }

  protected holdKeyDown(e: KeyboardEvent): void {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || this.keyHeld || this.busy()) return;
    if (this.shiftMode() === 'stale') {
      this.toStale();
      return;
    }
    if (this.shiftMode() === 'closed') {
      this.toast.show(this.i18n.t('day.closedBlock'));
      return;
    }
    this.keyHeld = true;
    this.startHold();
  }

  protected holdKeyUp(e: KeyboardEvent): void {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    this.keyHeld = false;
    this.holdCancel();
  }

  protected holdCancel(): void {
    this.stopFrame();
    this.hold.set(0);
  }

  private toStale(): void {
    void this.router.navigate(['/w/orders']);
    this.toast.show(this.i18n.t('nav.staleTip'));
  }

  private startHold(): void {
    this.stopFrame();
    this.holdStarted = performance.now();
    const tick = (now: number): void => {
      const p = Math.min(1, (now - this.holdStarted) / this.holdMs);
      this.hold.set(p);
      if (p < 1) {
        this.frame = requestAnimationFrame(tick);
        return;
      }
      this.frame = null;
      this.keyHeld = false;
      try {
        navigator.vibrate?.(40);
      } catch {
        /* unsupported */
      }
      void this.toggleShift().finally(() => this.hold.set(0));
    };
    this.frame = requestAnimationFrame(tick);
  }

  private wave(kind: 'start' | 'end'): void {
    clearTimeout(this.burstTimer);
    this.burst.set(null);
    // a frame apart, so a second wave right after the first still restarts
    requestAnimationFrame(() => {
      this.burst.set(kind);
      this.burstTimer = setTimeout(() => this.burst.set(null), 900);
    });
  }

  private stopFrame(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private async toggleShift(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (this.store.openShift()) {
        const minutes = await this.store.endShift();
        this.wave('end');
        this.toast.success(this.i18n.t('shift.endedToast', { time: this.i18n.time(Date.now()), duration: formatDuration(minutes) }));
      } else {
        const siteId = await this.store.chooseSite();
        if (siteId === undefined) return;
        const entry = await this.store.startShift(siteId);
        this.wave('start');
        this.toast.success(startedMessage(this.i18n, entry.startedAt, this.store.shiftSiteName()));
      }
    } catch (err: unknown) {
      this.toast.error(workflowMessage(this.i18n, err));
    } finally {
      this.busy.set(false);
    }
  }
}
