import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';

/**
 * Hold-to-confirm slab for consequential field actions (START/END WORK, FINISH ORDER).
 * A gloved accidental brush cannot trigger it; a deliberate 1 s press can. Pointer and keyboard
 * (holding Space or Enter) behave the same. Vibrates on confirm where the device supports it.
 */
@Component({
  selector: 'aon-hold-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button
      type="button"
      class="hold relative isolate flex w-full touch-none select-none flex-col items-center justify-center overflow-hidden rounded-[0.6rem] px-6 text-center transition-transform duration-150 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      [class]="toneClass()"
      [style.min-height.px]="height()"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel() || label()"
      [attr.aria-describedby]="hintId"
      (pointerdown)="begin($event)"
      (pointerup)="cancel()"
      (pointerleave)="cancel()"
      (pointercancel)="cancel()"
      (keydown)="onKeyDown($event)"
      (keyup)="onKeyUp($event)"
      (blur)="cancel()"
      (contextmenu)="$event.preventDefault()"
    >
      <span
        class="absolute inset-y-0 left-0 -z-10 origin-left"
        [class]="fillClass()"
        [style.width.%]="progress() * 100"
        aria-hidden="true"
      ></span>
      <span class="text-[1.15rem] font-semibold leading-tight tracking-[0.01em]">{{ label() }}</span>
      <span [id]="hintId" class="shrink-0 text-[0.8rem] font-normal opacity-80">
        {{ holding() ? '…' : hint() }}
      </span>
    </button>
  `,
})
export class HoldButtonComponent {
  private readonly destroyRef = inject(DestroyRef);
  private static nextId = 0;

  readonly label = input.required<string>();
  readonly hint = input<string>('');
  readonly ariaLabel = input<string>('');
  readonly tone = input<'gold' | 'charcoal' | 'hold'>('gold');
  readonly height = input<number>(88);
  readonly disabled = input<boolean>(false);
  readonly durationMs = input<number>(900);
  readonly confirmed = output<void>();

  protected readonly hintId = `aon-hold-hint-${HoldButtonComponent.nextId++}`;
  protected readonly progress = signal(0);
  protected readonly holding = computed(() => this.progress() > 0);

  protected readonly toneClass = computed(() => {
    switch (this.tone()) {
      case 'charcoal':
        return 'bg-[var(--color-rail)] text-white';
      case 'hold':
        return 'bg-hold text-white';
      default:
        return 'bg-gold text-[var(--color-charcoal)]';
    }
  });
  protected readonly fillClass = computed(() => (this.tone() === 'gold' ? 'bg-charcoal/25' : 'bg-white/25'));

  private frame: number | null = null;
  private startedAt = 0;
  private keyHeld = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.stop());
  }

  protected begin(event: PointerEvent): void {
    if (this.disabled() || event.button !== 0) return;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.startHold();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat || this.keyHeld) return;
    this.keyHeld = true;
    this.startHold();
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    this.keyHeld = false;
    this.cancel();
  }

  protected cancel(): void {
    this.stop();
    this.progress.set(0);
  }

  private startHold(): void {
    this.stop();
    this.startedAt = performance.now();
    const tick = (now: number): void => {
      const p = Math.min(1, (now - this.startedAt) / this.durationMs());
      this.progress.set(p);
      if (p >= 1) {
        this.stop();
        this.progress.set(0);
        this.keyHeld = false;
        try {
          navigator.vibrate?.(40);
        } catch {
          /* unsupported */
        }
        this.confirmed.emit();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
