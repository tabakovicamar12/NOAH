import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import type { LocalPhoto, LocalWorkOrder } from '../../../core/db/aon-db';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PHOTO_CATEGORIES, type PhotoCategory, type WorkOrderStatus } from '../../../core/models/domain.models';
import { ToastService } from '../../../core/ui/toast.service';
import { PrivacyPrefsService } from '../../../core/privacy/privacy-prefs.service';
import { BlobUrls } from '../../../shared/ui/blob-urls';
import { NoticeSheetComponent, type NoticePoint } from '../../../shared/ui/notice-sheet.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { WorkerStore } from '../data/worker-store.service';
import { workflowMessage } from '../data/workflow-messages';
import { PHOTO_ICON, PhotoReviewComponent } from './photo-review.component';
import { storagePressure } from './photo-processing';

/** The category a worker most likely wants next, given where the order stands. */
const SUGGESTED: Readonly<Record<WorkOrderStatus, PhotoCategory>> = {
  NEW: 'BEFORE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'FINISHED',
  ISSUE: 'ISSUE',
};

/**
 * Photos on a work order: four category tiles that open the camera in one tap, the review sheet, and the
 * gallery of this worker's photos still on the device. No limit on how many.
 */
@Component({
  selector: 'aon-order-photos',
  imports: [IconComponent, PhotoReviewComponent, NoticeSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-8" aria-labelledby="photos-title">
      <div class="flex items-baseline justify-between border-b-2 border-charcoal pb-1">
        <h2 id="photos-title" class="font-cond text-2xl">{{ i18n.t('order.photosTitle') }}</h2>
        @if (pendingCount()) {
          <span class="flex items-center gap-1.5 label-caps text-ink"><aon-icon name="refresh" [size]="14" [stroke]="3" />{{ i18n.t('photo.pendingCount', { n: pendingCount() }) }}</span>
        } @else {
          <span class="label-caps text-ink-muted">{{ i18n.t('photo.count', { n: mine().length }) }}</span>
        }
      </div>

      @if (pressure() !== null && pressure()! > 0.85) {
        <p class="mt-3 flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="status">
          <aon-icon name="alert" [size]="20" />{{ i18n.t('photo.storageLow') }}
        </p>
      }

      <div class="mt-3 grid grid-cols-2 gap-2" role="group" [attr.aria-label]="i18n.t('order.addPhoto')">
        @for (c of categories; track c) {
          @let suggested = c === suggestion();
          <button
            type="button"
            class="relative flex min-h-[5.5rem] flex-col items-start justify-between px-4 py-3 text-left"
            [class]="tileClass(c, suggested)"
            [attr.aria-label]="i18n.t('photo.takeAria', { category: i18n.t(catKey(c)) })"
            (click)="open(c)"
          >
            <span class="flex w-full items-center justify-between">
              <aon-icon [name]="icon[c]" [size]="24" [stroke]="2.5" />
              <span class="flex items-center gap-1 font-cond text-xl">
                <aon-icon name="camera" [size]="18" [stroke]="2.5" />{{ countFor(c) }}
              </span>
            </span>
            <span class="font-cond text-xl leading-tight">{{ i18n.t(catKey(c)) }}</span>
          </button>
        }
      </div>
      <input #picker type="file" accept="image/*" capture="environment" class="sr-only" tabindex="-1" aria-hidden="true" (change)="picked($event)" />

      @if (withPreview().length) {
        <ul class="mt-4 grid grid-cols-3 gap-2">
          @for (p of withPreview(); track p.id) {
            <li>
              <button
                type="button"
                class="relative block w-full bg-charcoal text-left"
                [attr.aria-label]="i18n.t('photo.openAria', { category: i18n.t(catKey(p.category)), time: i18n.time(p.createdAt) })"
                (click)="viewing.set(p)"
              >
                <img [src]="previewUrl(p)" alt="" class="aspect-square w-full object-cover" />
                <span
                  class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1.5 py-1 text-[0.7rem] font-extrabold uppercase tracking-wide"
                  [class]="p.category === 'ISSUE' ? 'bg-hold text-white' : 'bg-charcoal/90 text-white'"
                >
                  {{ i18n.time(p.createdAt) }}
                  <aon-icon [name]="p.synced ? 'circle-check' : 'refresh'" [size]="12" [stroke]="3" [class]="p.synced ? 'text-done-pale' : 'text-gold'" />
                </span>
                <!-- The stub edge: perforated while the photo waits on the device, solid once the server has it. -->
                <span
                  class="pointer-events-none absolute inset-0 outline-[3px] -outline-offset-[3px]"
                  [class]="p.synced ? 'outline-solid outline-charcoal' : 'outline-dashed outline-gold'"
                ></span>
              </button>
            </li>
          }
        </ul>
      }
      @if (uploadedOnly() > 0) {
        <p class="mt-2 flex items-center gap-2 text-[0.95rem] font-semibold text-ink-muted">
          <aon-icon name="circle-check" [size]="18" class="text-done" />{{ i18n.t('photo.onServer', { n: uploadedOnly() }) }}
        </p>
      }
      @if (mine().length === 0) {
        <p class="mt-3 text-[0.95rem] text-ink-muted">{{ i18n.t('photo.emptyHint') }}</p>
      }
    </section>

    @if (viewing(); as p) {
      <div class="fixed inset-0 z-[70] flex flex-col bg-charcoal-deep text-white" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t(catKey(p.category))" (keydown.escape)="viewing.set(null)">
        <div class="flex items-center justify-between gap-3 bg-charcoal px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
          <p class="min-w-0">
            <span class="block font-cond text-2xl leading-tight">{{ i18n.t(catKey(p.category)) }}</span>
            <span class="block truncate text-sm font-semibold text-on-dark-muted">{{ orderLabel() }} · {{ i18n.date(p.createdAt) }} {{ i18n.time(p.createdAt) }}</span>
          </p>
          <button type="button" class="grid size-14 place-items-center ring-2 ring-inset ring-white/40" [attr.aria-label]="i18n.t('common.close')" (click)="viewing.set(null)">
            <aon-icon name="x" [size]="26" [stroke]="2.5" />
          </button>
        </div>
        <div class="grid min-h-0 flex-1 place-items-center p-4">
          <img [src]="fullUrl(p)" [alt]="i18n.t('photo.alt', { category: i18n.t(catKey(p.category)), code: orderLabel() })" class="max-h-full max-w-full object-contain" />
        </div>
        <div class="grid gap-3 bg-ground px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 text-ink">
          @if (p.caption) {
            <p class="text-lg font-semibold leading-snug">{{ p.caption }}</p>
          }
          <p class="flex items-center gap-2 label-caps text-ink-muted">
            <aon-icon [name]="p.synced ? 'circle-check' : 'refresh'" [size]="16" />
            {{ p.synced ? i18n.t('photo.uploaded') : i18n.t('photo.waiting') }}
            @if (p.maskCount) {
              · {{ i18n.t('photo.masks', { n: p.maskCount }) }}
            }
          </p>
          @if (!p.synced) {
            <button type="button" class="flex min-h-14 items-center justify-center gap-2 bg-stock font-cond text-lg text-hold-ink ring-2 ring-inset ring-hold" (click)="remove(p)">
              <aon-icon name="trash" [size]="20" />{{ i18n.t('photo.delete') }}
            </button>
          }
        </div>
      </div>
    }

    @if (cameraNotice()) {
      <aon-notice-sheet
        [heading]="i18n.t('camera.noticeTitle')"
        icon="camera"
        [points]="cameraPoints()"
        [acceptLabel]="i18n.t('camera.noticeAccept')"
        [declineLabel]="i18n.t('common.cancel')"
        (accepted)="cameraNoticeAccepted()"
        (declined)="cameraNotice.set(false)"
      />
    }

    @if (reviewFile(); as file) {
      <aon-photo-review
        [file]="file"
        [orderId]="order().id"
        [orderLabel]="orderLabel()"
        [initialCategory]="pendingCategory()"
        (anotherRequested)="another($event)"
        (done)="reviewDone()"
        (retake)="retake()"
        (cancelled)="closeReview()"
      />
    }
  `,
})
export class OrderPhotosComponent {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(WorkerStore);
  private readonly toast = inject(ToastService);

  readonly order = input.required<LocalWorkOrder>();
  readonly orderLabel = input<string>('');

  protected readonly categories = PHOTO_CATEGORIES;
  protected readonly icon = PHOTO_ICON;
  protected readonly pressure = signal<number | null>(null);
  protected readonly viewing = signal<LocalPhoto | null>(null);
  protected readonly reviewFile = signal<Blob | null>(null);
  protected readonly pendingCategory = signal<PhotoCategory>('IN_PROGRESS');
  protected readonly cameraNotice = signal(false);
  private readonly prefs = inject(PrivacyPrefsService);
  protected readonly cameraPoints = computed<readonly NoticePoint[]>(() => [
    { icon: 'camera', text: this.i18n.t('camera.noticeP1') },
    { icon: 'eye-off', text: this.i18n.t('camera.noticeP2') },
    { icon: 'shield', text: this.i18n.t('camera.noticeP3') },
  ]);
  /** A photo taken through "save and another" while the previous one was still being stored. */
  private queuedFile: Blob | null = null;
  private awaitingAnother = false;

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private readonly urls = new BlobUrls();

  protected readonly suggestion = computed(() => SUGGESTED[this.order().status]);
  protected readonly mine = computed(() => this.store.photos().filter((p) => p.workOrderId === this.order().id));
  protected readonly withPreview = computed(() => this.mine().filter((p) => p.thumb || p.blob));
  protected readonly pendingCount = computed(() => this.mine().filter((p) => !p.synced).length);
  protected readonly uploadedOnly = computed(() => this.mine().length - this.withPreview().length);

  constructor() {
    void storagePressure().then((p) => this.pressure.set(p));
    effect(() => this.urls.prune(new Set(this.mine().flatMap((p) => [p.id, `${p.id}:full`]))));
    inject(DestroyRef).onDestroy(() => this.urls.clear());
  }

  protected catKey(c: PhotoCategory): `photoCat.${PhotoCategory}` {
    return `photoCat.${c}`;
  }

  protected countFor(c: PhotoCategory): number {
    return this.mine().filter((p) => p.category === c).length;
  }

  protected tileClass(c: PhotoCategory, suggested: boolean): string {
    if (c === 'ISSUE') return suggested ? 'bg-hold text-white' : 'bg-stock text-hold-ink ring-2 ring-inset ring-hold';
    return suggested ? 'bg-gold text-ink' : 'bg-stock text-ink ring-2 ring-inset ring-charcoal';
  }

  protected previewUrl(p: LocalPhoto): string | null {
    return this.urls.url(p.id, p.thumb ?? p.blob);
  }

  protected fullUrl(p: LocalPhoto): string | null {
    return p.blob ? this.urls.url(`${p.id}:full`, p.blob) : this.previewUrl(p);
  }

  protected open(c: PhotoCategory): void {
    this.pendingCategory.set(c);
    if (!this.prefs.cameraNoticeSeen()) {
      this.cameraNotice.set(true);
      return;
    }
    this.picker().nativeElement.click();
  }

  /** The notice's button is the user gesture that opens the camera, so the camera opens on that tap. */
  protected cameraNoticeAccepted(): void {
    this.prefs.acknowledgeCamera();
    this.cameraNotice.set(false);
    this.picker().nativeElement.click();
  }

  protected picked(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0] ?? null;
    el.value = '';
    if (!file) {
      this.awaitingAnother = false;
      return;
    }
    if (this.awaitingAnother && this.reviewFile()) {
      this.queuedFile = file;
      return;
    }
    this.awaitingAnother = false;
    this.reviewFile.set(file);
  }

  protected another(category: PhotoCategory): void {
    this.pendingCategory.set(category);
    this.awaitingAnother = true;
    this.picker().nativeElement.click();
  }

  protected reviewDone(): void {
    const next = this.queuedFile;
    this.queuedFile = null;
    if (next) {
      this.awaitingAnother = false;
      this.reviewFile.set(next);
    } else if (!this.awaitingAnother) {
      this.reviewFile.set(null);
    } else {
      // The camera is still open for the next shot; close the sheet and let `picked` open the next review.
      this.reviewFile.set(null);
    }
  }

  protected retake(): void {
    this.reviewFile.set(null);
    this.picker().nativeElement.click();
  }

  protected closeReview(): void {
    this.awaitingAnother = false;
    this.queuedFile = null;
    this.reviewFile.set(null);
  }

  protected async remove(p: LocalPhoto): Promise<void> {
    try {
      await this.store.deletePhoto(p.id);
      this.viewing.set(null);
      this.toast.show(this.i18n.t('photo.deleted'));
    } catch (err: unknown) {
      this.toast.error(workflowMessage(this.i18n, err));
    }
  }
}
