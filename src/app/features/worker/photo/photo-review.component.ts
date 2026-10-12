import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PHOTO_CATEGORIES, type PhotoCategory } from '../../../core/models/domain.models';
import { ToastService } from '../../../core/ui/toast.service';
import { IconComponent, type IconName } from '../../../shared/ui/icon.component';
import { WorkerStore } from '../data/worker-store.service';
import { workflowMessage } from '../data/workflow-messages';
import { decodePhoto, fitSize, paintMasks, renderPhoto, type MaskRect } from './photo-processing';

export const PHOTO_ICON: Readonly<Record<PhotoCategory, IconName>> = {
  BEFORE: 'camera',
  IN_PROGRESS: 'timer',
  FINISHED: 'circle-check',
  ISSUE: 'alert',
};

type Phase = 'DECODING' | 'READY' | 'FAILED' | 'SAVING';

/**
 * Full-screen review between the camera and the device store: choose the category, black out faces or
 * number plates by dragging, confirm privacy, save. Nothing reaches the store until the worker saves.
 */
@Component({
  selector: 'aon-photo-review',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fixed inset-0 z-[70] flex flex-col bg-charcoal-deep text-white',
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': "i18n.t('photo.title')",
    '(document:keydown.escape)': 'cancel()',
  },
  template: `
    <div class="flex items-center justify-between gap-3 bg-charcoal px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <p class="min-w-0">
        <span class="block font-cond text-2xl leading-tight">{{ i18n.t('photo.title') }}</span>
        <span class="block truncate text-sm font-semibold text-on-dark-muted">{{ orderLabel() }}</span>
      </p>
      <button type="button" class="grid size-14 place-items-center ring-2 ring-inset ring-white/40" [attr.aria-label]="i18n.t('common.cancel')" (click)="cancel()">
        <aon-icon name="x" [size]="26" [stroke]="2.5" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- Stage -->
      <div #stage class="relative grid place-items-center px-4 pt-4">
        @switch (phase()) {
          @case ('DECODING') {
            <div class="grid h-56 w-full place-items-center bg-charcoal" aria-busy="true">
              <span class="font-cond text-xl text-on-dark-muted">{{ i18n.t('photo.processing') }}</span>
            </div>
          }
          @case ('FAILED') {
            <div class="w-full border-2 border-hold bg-hold px-4 py-5 font-semibold" role="alert">
              <aon-icon name="image-off" [size]="26" />
              <p class="mt-2">{{ i18n.t('photo.processFailed') }}</p>
            </div>
          }
          @default {
            <canvas
              #canvas
              class="block touch-none select-none ring-2 ring-white/25"
              [style.width.px]="view().width"
              [style.height.px]="view().height"
              role="img"
              [attr.aria-label]="i18n.t('photo.canvasLabel')"
              (pointerdown)="maskStart($event)"
              (pointermove)="maskMove($event)"
              (pointerup)="maskEnd()"
              (pointercancel)="maskCancel()"
            ></canvas>
          }
        }
      </div>

      @if (phase() !== 'FAILED' && phase() !== 'DECODING') {
        <div class="px-4 pt-3">
          <p class="flex items-start gap-2 text-[0.95rem] font-semibold text-on-dark-muted">
            <aon-icon name="eye-off" [size]="20" class="mt-0.5 text-gold" />{{ i18n.t('photo.instruction') }}
          </p>
          <div class="mt-3 flex items-center justify-between gap-2">
            <span class="label-caps text-on-dark-muted" aria-live="polite">{{ i18n.t('photo.masks', { n: masks().length }) }}</span>
            <span class="flex gap-2">
              <button type="button" class="flex min-h-12 items-center gap-2 px-4 font-cond text-lg ring-2 ring-inset ring-white/40 disabled:opacity-40" [disabled]="masks().length === 0" (click)="undo()">
                <aon-icon name="undo" [size]="20" />{{ i18n.t('photo.undo') }}
              </button>
              <button type="button" class="flex min-h-12 items-center gap-2 px-4 font-cond text-lg ring-2 ring-inset ring-white/40 disabled:opacity-40" [disabled]="masks().length === 0" (click)="masks.set([])">
                {{ i18n.t('photo.clear') }}
              </button>
            </span>
          </div>
        </div>

        <!-- Panel -->
        <div class="mt-4 grid gap-5 bg-ground px-4 pb-6 pt-5 text-ink">
          <fieldset>
            <legend class="label-caps text-ink-muted">{{ i18n.t('photo.category') }}</legend>
            <div class="mt-2 grid grid-cols-2 gap-2">
              @for (c of categories; track c) {
                <button
                  type="button"
                  class="flex min-h-14 items-center gap-2 px-3 text-left font-cond text-lg"
                  [class]="category() === c ? (c === 'ISSUE' ? 'bg-hold text-white' : 'bg-charcoal text-white') : 'bg-stock ring-2 ring-inset ring-charcoal'"
                  [attr.aria-pressed]="category() === c"
                  (click)="category.set(c)"
                >
                  <aon-icon [name]="icon[c]" [size]="20" [stroke]="2.5" />{{ i18n.t(catKey(c)) }}
                </button>
              }
            </div>
          </fieldset>

          <label class="block">
            <span class="label-caps text-ink-muted">{{ i18n.t('photo.caption') }}</span>
            <input
              type="text"
              maxlength="280"
              class="mt-1 block min-h-14 w-full border-2 border-charcoal bg-stock px-4 text-lg font-semibold outline-none placeholder:font-normal placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
              [placeholder]="i18n.t('photo.captionPlaceholder')"
              [value]="caption()"
              (input)="caption.set($any($event.target).value)"
            />
          </label>

          <div class="grid gap-3" role="group" [attr.aria-label]="i18n.t('photo.title')">
            <label class="flex cursor-pointer items-start gap-3">
              <input type="checkbox" class="aon-check" [checked]="check1()" (change)="check1.set($any($event.target).checked)" />
              <span class="pt-0.5 font-semibold leading-snug">{{ i18n.t('photo.check1') }}</span>
            </label>
            <label class="flex cursor-pointer items-start gap-3">
              <input type="checkbox" class="aon-check" [checked]="check2()" (change)="check2.set($any($event.target).checked)" />
              <span class="pt-0.5 font-semibold leading-snug">{{ i18n.t('photo.check2') }}</span>
            </label>
            @if (showConfirmError()) {
              <p class="flex items-center gap-2 font-semibold text-hold-ink" role="alert"><aon-icon name="alert" [size]="18" />{{ i18n.t('photo.confirmRequired') }}</p>
            }
          </div>

          <div class="grid gap-2">
            <button
              type="button"
              class="flex min-h-[4.5rem] items-center justify-between bg-gold px-6 font-cond text-[1.6rem] text-ink disabled:opacity-50"
              [disabled]="phase() === 'SAVING'"
              (click)="save(false)"
            >
              {{ phase() === 'SAVING' ? i18n.t('photo.processing') : i18n.t('photo.save') }}<aon-icon name="check" [size]="28" [stroke]="3" />
            </button>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="flex min-h-14 items-center justify-center gap-2 bg-charcoal font-cond text-lg text-white disabled:opacity-50"
                [disabled]="phase() === 'SAVING'"
                (click)="save(true)"
              >
                <aon-icon name="camera" [size]="20" />{{ i18n.t('photo.saveAnother') }}
              </button>
              <button
                type="button"
                class="flex min-h-14 items-center justify-center gap-2 bg-stock font-cond text-lg ring-2 ring-inset ring-charcoal disabled:opacity-50"
                [disabled]="phase() === 'SAVING'"
                (click)="retake.emit()"
              >
                <aon-icon name="retry" [size]="20" />{{ i18n.t('photo.retake') }}
              </button>
            </div>
            <p class="mt-1 flex items-start gap-2 text-sm font-semibold text-ink-muted">
              <aon-icon name="shield" [size]="16" class="mt-0.5" />{{ i18n.t('photo.disclaimer') }}
            </p>
          </div>
        </div>
      } @else if (phase() === 'FAILED') {
        <div class="grid gap-2 px-4 py-4">
          <button type="button" class="flex min-h-16 items-center justify-center gap-2 bg-gold font-cond text-xl text-ink" (click)="retake.emit()">
            <aon-icon name="camera" [size]="22" />{{ i18n.t('photo.retake') }}
          </button>
        </div>
      }
    </div>
  `,
})
export class PhotoReviewComponent {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(WorkerStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly file = input.required<Blob>();
  readonly orderId = input.required<string>();
  readonly orderLabel = input<string>('');
  readonly initialCategory = input<PhotoCategory>('IN_PROGRESS');

  /** Emitted synchronously inside the click, so the camera can reopen under the same user gesture. */
  readonly anotherRequested = output<PhotoCategory>();
  readonly done = output<void>();
  readonly retake = output<void>();
  readonly cancelled = output<void>();

  protected readonly categories = PHOTO_CATEGORIES;
  protected readonly icon = PHOTO_ICON;

  protected readonly phase = signal<Phase>('DECODING');
  protected readonly masks = signal<readonly MaskRect[]>([]);
  protected readonly draftMask = signal<MaskRect | null>(null);
  protected readonly category = signal<PhotoCategory>('IN_PROGRESS');
  protected readonly caption = signal('');
  protected readonly check1 = signal(false);
  protected readonly check2 = signal(false);
  protected readonly showConfirmError = signal(false);

  private readonly bitmap = signal<ImageBitmap | null>(null);
  private readonly stageWidth = signal(360);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private dragFrom: { x: number; y: number } | null = null;

  protected readonly view = computed(() => {
    const bmp = this.bitmap();
    if (!bmp) return { width: 0, height: 0 };
    const maxW = Math.max(200, this.stageWidth());
    const maxH = Math.max(220, Math.round(window.innerHeight * 0.5));
    const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
    return { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) };
  });

  constructor() {
    effect(() => this.category.set(this.initialCategory()));
    effect(() => {
      const file = this.file();
      void this.decode(file);
    });

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) this.stageWidth.set(Math.floor(w));
    });
    afterRenderEffect(() => {
      const el = this.stage()?.nativeElement;
      if (el) {
        observer.disconnect();
        observer.observe(el);
      }
    });

    // Repaint the preview whenever the photo, its size or the masks change.
    afterRenderEffect(() => {
      const el = this.canvas()?.nativeElement;
      const bmp = this.bitmap();
      const { width, height } = this.view();
      const masks = this.masks();
      const draft = this.draftMask();
      if (!el || !bmp || !width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = fitSize(width * dpr, height * dpr, 4096);
      if (el.width !== px.width || el.height !== px.height) {
        el.width = px.width;
        el.height = px.height;
      }
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bmp, 0, 0, px.width, px.height);
      paintMasks(ctx, masks, px.width, px.height);
      if (draft) {
        ctx.fillStyle = 'rgb(0 0 0 / 0.55)';
        ctx.fillRect(draft.x * px.width, draft.y * px.height, draft.w * px.width, draft.h * px.height);
        ctx.strokeStyle = '#c1a050';
        ctx.lineWidth = 3 * dpr;
        ctx.setLineDash([8 * dpr, 6 * dpr]);
        ctx.strokeRect(draft.x * px.width, draft.y * px.height, draft.w * px.width, draft.h * px.height);
        ctx.setLineDash([]);
      }
    });

    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      this.bitmap()?.close();
    });
  }

  protected catKey(c: PhotoCategory): `photoCat.${PhotoCategory}` {
    return `photoCat.${c}`;
  }

  protected cancel(): void {
    if (this.phase() !== 'SAVING') this.cancelled.emit();
  }

  protected undo(): void {
    this.masks.update((m) => m.slice(0, -1));
  }

  protected maskStart(event: PointerEvent): void {
    if (this.phase() !== 'READY') return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragFrom = this.norm(event);
    this.draftMask.set({ ...this.dragFrom, w: 0, h: 0 });
  }

  protected maskMove(event: PointerEvent): void {
    if (!this.dragFrom) return;
    const p = this.norm(event);
    this.draftMask.set({
      x: Math.min(this.dragFrom.x, p.x),
      y: Math.min(this.dragFrom.y, p.y),
      w: Math.abs(p.x - this.dragFrom.x),
      h: Math.abs(p.y - this.dragFrom.y),
    });
  }

  protected maskEnd(): void {
    const draft = this.draftMask();
    this.dragFrom = null;
    this.draftMask.set(null);
    // A tap (not a drag) blacks out a finger-sized square, which is enough for a plate seen from afar.
    const rect = draft && (draft.w < 0.02 || draft.h < 0.02) ? { x: Math.max(0, draft.x - 0.06), y: Math.max(0, draft.y - 0.06), w: 0.12, h: 0.12 } : draft;
    if (rect) this.masks.update((m) => [...m, rect]);
  }

  protected maskCancel(): void {
    this.dragFrom = null;
    this.draftMask.set(null);
  }

  protected save(another: boolean): void {
    if (this.phase() !== 'READY') return;
    if (!this.check1() || !this.check2()) {
      this.showConfirmError.set(true);
      return;
    }
    this.showConfirmError.set(false);
    if (another) this.anotherRequested.emit(this.category());
    void this.persist();
  }

  private async persist(): Promise<void> {
    const bmp = this.bitmap();
    if (!bmp) return;
    this.phase.set('SAVING');
    try {
      const processed = await renderPhoto(bmp, this.masks());
      await this.store.savePhoto({
        orderId: this.orderId(),
        category: this.category(),
        caption: this.caption(),
        blob: processed.blob,
        thumb: processed.thumb,
        width: processed.width,
        height: processed.height,
        maskCount: this.masks().length,
      });
      this.toast.success(this.i18n.t('photo.saved'));
      this.done.emit();
    } catch (err: unknown) {
      this.phase.set('READY');
      this.toast.error(workflowMessage(this.i18n, err));
    }
  }

  private async decode(file: Blob): Promise<void> {
    this.phase.set('DECODING');
    this.masks.set([]);
    this.caption.set('');
    this.check1.set(false);
    this.check2.set(false);
    try {
      const bmp = await decodePhoto(file);
      this.bitmap()?.close();
      this.bitmap.set(bmp);
      this.phase.set('READY');
    } catch (err: unknown) {
      console.warn('[AON] photo decode failed', err);
      this.phase.set('FAILED');
    }
  }

  private norm(event: PointerEvent): { x: number; y: number } {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const clamp = (v: number): number => Math.min(1, Math.max(0, v));
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
}
