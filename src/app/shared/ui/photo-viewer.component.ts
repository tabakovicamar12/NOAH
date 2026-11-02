import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from './icon.component';

/** How far a finger must travel, mostly sideways, before a swipe turns the photo. */
const SWIPE_PX = 60;

/**
 * The one full-screen photo viewer of the app. The photo always fits between the bars whatever its shape, the
 * page behind stays still, and photos turn with a swipe, the arrows or the arrow keys. Pinching zooms as usual.
 * Anything a screen adds (the worker's delete) comes in as content under the photo.
 */
@Component({
  selector: 'aon-photo-viewer',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    <div class="pv" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <header class="pv-top">
        <p class="pv-head">
          <b>{{ title() }}</b>
          <span>{{ meta() }}</span>
        </p>
        @if (total() > 1) {
          <span class="pv-count">{{ index() + 1 }} / {{ total() }}</span>
        }
        <button #closeBtn type="button" class="pv-x" [attr.aria-label]="i18n.t('common.close')" (click)="closed.emit()"><aon-icon name="x" [size]="22" [stroke]="2" /></button>
      </header>

      <div class="pv-main">
        <div class="pv-stage" (pointerdown)="down($event)" (pointerup)="up($event)" (pointercancel)="from = null">
          @for (s of [src()]; track s) {
            @if (s) {
              <img [src]="s" [alt]="alt()" draggable="false" />
            } @else {
              <aon-icon name="image-off" [size]="40" class="pv-none" />
            }
          }
        </div>
        @if (total() > 1) {
          <div class="pv-navs">
            <button type="button" class="pv-nav" [attr.aria-label]="i18n.t('op.prevPhoto')" (click)="step.emit(-1)"><aon-icon name="chevron-left" [size]="26" /></button>
            <button type="button" class="pv-nav" [attr.aria-label]="i18n.t('op.nextPhoto')" (click)="step.emit(1)"><aon-icon name="chevron-right" [size]="26" /></button>
          </div>
        }
      </div>

      @if (caption(); as text) {
        <p class="pv-cap">{{ text }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .pv {
      position: fixed;
      inset: 0;
      z-index: 120;
      display: flex;
      flex-direction: column;
      background: #141414;
      color: #fff;
      font-family: var(--font-ui);
      overscroll-behavior: contain;
      animation: pv-in 180ms var(--ease-out-expo) both;
    }
    @keyframes pv-in {
      from {
        opacity: 0;
      }
    }
    .pv-top {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 0.75rem;
      padding: calc(env(safe-area-inset-top) + 0.5rem) calc(env(safe-area-inset-right) + 0.75rem) 0.5rem calc(env(safe-area-inset-left) + 1rem);
    }
    .pv-head {
      display: grid;
      flex: 1 1 auto;
      min-width: 0;
      line-height: 1.25;
    }
    .pv-head b {
      font-weight: 600;
    }
    .pv-head span {
      color: #bdbbb5;
      font-size: 0.85rem;
    }
    .pv-count {
      flex: 0 0 auto;
      color: #bdbbb5;
      font-size: 0.9rem;
      font-variant-numeric: tabular-nums;
    }
    .pv-x,
    .pv-nav {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      background: rgb(255 255 255 / 0.12);
      color: #fff;
      transition: background-color 140ms var(--ease-out-expo);
    }
    .pv-x:hover,
    .pv-nav:hover {
      background: rgb(255 255 255 / 0.22);
    }
    .pv-x:focus-visible,
    .pv-nav:focus-visible {
      outline: 2px solid var(--color-gold);
      outline-offset: 2px;
      box-shadow: none;
    }
    .pv-x {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 0.6rem;
    }
    .pv-main {
      position: relative;
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      min-height: 0;
    }
    /* Absolute inside the stage: whatever the photo's shape, it cannot grow past the room it was given. */
    .pv-stage {
      position: relative;
      flex: 1 1 0;
      min-height: 0;
      touch-action: pinch-zoom;
    }
    .pv-stage img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      animation: pv-in 160ms var(--ease-out-expo) both;
    }
    .pv-none {
      position: absolute;
      top: 50%;
      left: 50%;
      color: #6b6a65;
      transform: translate(-50%, -50%);
    }
    /* Phone upright: two wide buttons in the thumb zone, under the photo and never over it. */
    .pv-navs {
      display: flex;
      flex: 0 0 auto;
      gap: 0.5rem;
      padding: 0.6rem calc(env(safe-area-inset-right) + 0.75rem) 0.6rem calc(env(safe-area-inset-left) + 0.75rem);
    }
    .pv-nav {
      flex: 1 1 0;
      height: 3.25rem;
      border-radius: 0.6rem;
    }
    .pv-cap {
      flex: 0 0 auto;
      max-height: 26dvh;
      overflow-y: auto;
      padding: 0.6rem calc(env(safe-area-inset-right) + 1rem) 0.75rem calc(env(safe-area-inset-left) + 1rem);
      border-top: 1px solid rgb(255 255 255 / 0.12);
      line-height: 1.4;
    }
    .pv > :last-child:not(ng-content) {
      padding-bottom: env(safe-area-inset-bottom);
    }
    /* Room at the sides (tablet, desk, a phone on its side): the photo takes the height, the arrows its flanks. */
    @media (min-width: 701px), (max-height: 500px) {
      .pv-stage {
        margin-inline: calc(env(safe-area-inset-left) + 4.5rem) calc(env(safe-area-inset-right) + 4.5rem);
      }
      .pv-navs {
        position: absolute;
        inset: 0;
        align-items: center;
        justify-content: space-between;
        padding-block: 0;
        pointer-events: none;
      }
      .pv-nav {
        flex: 0 0 auto;
        width: 3.25rem;
        border-radius: 9999px;
        pointer-events: auto;
      }
    }
    /* A phone on its side has little height: one line of text, and the caption stays short. */
    @media (max-height: 500px) {
      .pv-top {
        padding-block: calc(env(safe-area-inset-top) + 0.15rem) 0.15rem;
      }
      .pv-head {
        display: flex;
        gap: 0.6rem;
        align-items: baseline;
        white-space: nowrap;
      }
      .pv-head span {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pv-cap {
        max-height: 20dvh;
        padding-block: 0.35rem;
      }
    }
    @media print {
      .pv {
        display: none;
      }
    }
  `,
})
export class PhotoViewerComponent {
  protected readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private readonly closeBtn = viewChild.required<ElementRef<HTMLElement>>('closeBtn');

  readonly src = input.required<string | null>();
  readonly alt = input('');
  readonly title = input.required<string>();
  readonly meta = input('');
  readonly caption = input<string | null>(null);
  readonly index = input(0);
  readonly total = input(1);
  readonly step = output<-1 | 1>();
  readonly closed = output<void>();

  protected from: { readonly id: number; readonly x: number; readonly y: number } | null = null;

  constructor() {
    const root = this.document.documentElement;
    const before = root.style.overflow;
    const opener = this.document.activeElement as HTMLElement | null;
    root.style.overflow = 'hidden';
    afterNextRender(() => this.closeBtn().nativeElement.focus({ preventScroll: true }));
    inject(DestroyRef).onDestroy(() => {
      root.style.overflow = before;
      opener?.focus?.({ preventScroll: true });
    });
  }

  protected onKey(event: KeyboardEvent): void {
    // A confirmation opened over the photo answers its own keys.
    if (this.document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') this.closed.emit();
    else if (this.total() > 1 && event.key === 'ArrowLeft') this.step.emit(-1);
    else if (this.total() > 1 && event.key === 'ArrowRight') this.step.emit(1);
  }

  protected down(event: PointerEvent): void {
    // A second finger means a pinch, not a swipe.
    this.from = event.isPrimary && event.pointerType !== 'mouse' ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }

  protected up(event: PointerEvent): void {
    const from = this.from;
    this.from = null;
    if (!from || from.id !== event.pointerId || this.total() < 2) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 2) this.step.emit(dx < 0 ? 1 : -1);
  }
}
