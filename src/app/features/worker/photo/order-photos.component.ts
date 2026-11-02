import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import type { LocalPhoto, LocalWorkOrder } from '../../../core/db/aon-db';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PHOTO_CATEGORIES, type PhotoCategory, type WorkOrderStatus } from '../../../core/models/domain.models';
import { SessionStore } from '../../../core/auth/session.store';
import { ToastService } from '../../../core/ui/toast.service';
import { PrivacyPrefsService } from '../../../core/privacy/privacy-prefs.service';
import { BlobUrls } from '../../../shared/ui/blob-urls';
import { ConfirmDeleteComponent } from '../../../shared/ui/confirm-delete.component';
import { NoticeSheetComponent, type NoticePoint } from '../../../shared/ui/notice-sheet.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { PhotoViewerComponent } from '../../../shared/ui/photo-viewer.component';
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
 * Photos on a work order: the camera or the phone's gallery (several at once), the review sheet, and a strip of
 * this worker's photos still on the device. The category follows the order's stage; the review sheet can change it.
 */
@Component({
  selector: 'aon-order-photos',
  imports: [ConfirmDeleteComponent, IconComponent, PhotoReviewComponent, PhotoViewerComponent, NoticeSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="w-card" aria-labelledby="photos-title">
      <div class="ph-head">
        <h2 id="photos-title" class="ph-title">
          <b>{{ i18n.t('order.photosTitle') }}</b>
          @if (pendingCount()) {
            <small class="flex items-center gap-1"><aon-icon name="refresh" [size]="12" [stroke]="2.25" />{{ i18n.t('photo.pendingCount', { n: pendingCount() }) }}</small>
          } @else if (mine().length) {
            <small>{{ i18n.t('photo.count', { n: mine().length }) }}</small>
          }
        </h2>
        @if (canLog()) {
          <div class="ph-tools">
            <button type="button" class="ph-gadd" (click)="fromGallery()"><aon-icon name="plus" [size]="17" [stroke]="2" />{{ i18n.t('photo.upload') }}</button>
          </div>
        }
      </div>
      @if (waiting()) {
        <p class="w-small w-muted mt-2">{{ i18n.t('order.startToLog') }}</p>
      }
      @if (pressure() !== null && pressure()! > 0.85) {
        <p class="w-alert mt-3" role="status"><aon-icon name="alert" [size]="18" />{{ i18n.t('photo.storageLow') }}</p>
      }
      <!-- One row per kind of photo, so everyone sees what each picture documents. -->
      <div class="ph-groups">
        @for (c of categories; track c) {
          @let list = byCategory()[c];
          @if (list.length || canLog()) {
          <div class="ph-group" [class.is-bad]="c === 'ISSUE'" [class.is-empty]="!list.length">
            <div class="ph-ghead">
              <span class="ph-gname">
                <aon-icon [name]="icon[c]" [size]="16" [stroke]="2.2" />{{ i18n.t(catKey(c)) }}
                @if (list.length) {
                  <span class="ph-gn">{{ list.length }}</span>
                }
              </span>
              @if (canLog()) {
                <button type="button" class="ph-gadd" [attr.aria-label]="i18n.t('photo.addTo', { category: i18n.t(catKey(c)) })" (click)="open(c)">
                  <aon-icon name="camera" [size]="17" [stroke]="2" />
                  @if (!list.length) {
                    <span>{{ i18n.t('photo.take') }}</span>
                  }
                </button>
              }
            </div>
            @if (list.length) {
              <ul class="ph-strip">
                @for (p of list; track p.id) {
                  <li class="relative">
                    @if (canDelete()) {
                      <button type="button" class="thumb-del" [attr.aria-label]="i18n.t('photo.deleteAria', { time: i18n.time(p.createdAt) })" (click)="askRemove(p)">
                        <aon-icon name="x" [size]="15" [stroke]="2.5" />
                      </button>
                    }
                    <button type="button" class="thumb" [attr.aria-label]="i18n.t('photo.openAria', { category: i18n.t(catKey(p.category)), time: i18n.time(p.createdAt) })" (click)="viewing.set(p)">
                      <img [src]="previewUrl(p)" alt="" class="aspect-square w-full object-cover" />
                      <span class="thumb-cap" [class.is-bad]="p.category === 'ISSUE'">{{ i18n.time(p.createdAt) }}<aon-icon [name]="p.synced ? 'circle-check' : 'refresh'" [size]="12" [stroke]="2.5" /></span>
                      @if (!p.synced) {
                        <span class="thumb-wait"></span>
                      }
                    </button>
                    @if (p.caption) {
                      <p class="ph-cap">{{ p.caption }}</p>
                    }
                  </li>
                }
              </ul>
            }
          </div>
          }
        }
      </div>
      @if (uploadedOnly() > 0) {
        <p class="w-small w-muted mt-2 flex items-center gap-1.5"><aon-icon name="circle-check" [size]="15" />{{ i18n.t('photo.onServer', { n: uploadedOnly() }) }}</p>
      }
    </section>
    <input #picker type="file" accept="image/*" capture="environment" class="sr-only" tabindex="-1" aria-hidden="true" (change)="picked($event)" />
    <input #gallery type="file" accept="image/*" multiple class="sr-only" tabindex="-1" aria-hidden="true" (change)="picked($event)" />

    @if (viewing(); as p) {
      <aon-photo-viewer
        [src]="fullUrl(p)"
        [alt]="i18n.t('photo.alt', { category: i18n.t(catKey(p.category)), code: orderLabel() })"
        [title]="i18n.t(catKey(p.category))"
        [meta]="viewMeta(p)"
        [caption]="p.caption"
        [index]="viewIndex()"
        [total]="ordered().length"
        (step)="stepView($event)"
        (closed)="viewing.set(null)"
      >
        <div class="view-foot">
          <p class="w-small w-muted flex items-center gap-1.5">
            <aon-icon [name]="p.synced ? 'circle-check' : 'refresh'" [size]="15" />
            {{ p.synced ? i18n.t('photo.uploaded') : i18n.t('photo.waiting') }}
            @if (p.maskCount) {
              · {{ i18n.t('photo.masks', { n: p.maskCount }) }}
            }
          </p>
          @if (canDelete()) {
            <button type="button" class="w-btn w-btn-line del" (click)="askRemove(p)">
              <aon-icon name="trash" [size]="18" />{{ i18n.t('photo.delete') }}
            </button>
          }
        </div>
      </aon-photo-viewer>
    }

    @if (removing(); as r) {
      <aon-confirm-delete
        [heading]="i18n.t('photo.deleteTitle')"
        [points]="[i18n.t(r.synced ? 'photo.deleteWhatServer' : 'photo.deleteWhatLocal'), i18n.t('delete.irreversible')]"
        [confirmLabel]="i18n.t('photo.delete')"
        [busy]="removeBusy()"
        [error]="removeError()"
        (confirmed)="remove(r)"
        (cancelled)="removing.set(null)"
      />
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
  host: { class: 'block' },
  styles: `
    /* Photos: title and count, camera and gallery on the right, the photos as a strip. */
    .ph-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .ph-title {
      display: grid;
      gap: 0.05rem;
    }
    .ph-title b {
      font-size: 1.02rem;
      font-weight: 700;
    }
    .ph-title small {
      color: var(--color-text-muted);
      font-size: 0.82rem;
    }
    .ph-tools {
      display: flex;
      gap: 0.4rem;
    }
    /* minmax(0, 1fr): a long strip of photos scrolls inside its row and never widens the page. */
    .ph-groups {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.45rem;
      margin-top: 0.8rem;
    }
    .ph-group {
      min-width: 0;
      padding: 0.45rem 0.5rem 0.55rem 0.7rem;
      border-radius: 0.65rem;
      background: var(--color-row-tint);
      box-shadow: inset 0 0 0 1px var(--color-line);
    }
    .ph-group.is-empty {
      padding-bottom: 0.45rem;
      background: transparent;
    }
    .ph-ghead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .ph-gname {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.95rem;
      font-weight: 650;
    }
    .ph-group.is-empty .ph-gname {
      color: var(--color-text-muted);
      font-weight: 550;
    }
    .ph-group.is-bad .ph-gname {
      color: var(--color-bad);
    }
    .ph-gn {
      min-width: 1.4rem;
      padding: 0 0.4rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text);
      font-size: 0.8rem;
      line-height: 1.4rem;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .ph-gadd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      min-width: 2.75rem;
      min-height: 2.75rem;
      padding: 0 0.7rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.55rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-size: 0.88rem;
      font-weight: 600;
    }
    .ph-cap {
      display: -webkit-box;
      margin-top: 0.25rem;
      overflow: hidden;
      font-size: 0.8rem;
      line-height: 1.25;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .ph-strip {
      display: flex;
      gap: 0.45rem;
      margin: 0.45rem -0.5rem 0 -0.7rem;
      padding: 0 0.5rem 0.1rem 0.7rem;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
    }
    .ph-strip > li {
      flex: 0 0 6.5rem;
      scroll-snap-align: start;
    }
    .thumb {
      position: relative;
      display: block;
      width: 100%;
      overflow: hidden;
      border-radius: 0.5rem;
      background: var(--color-track);
      text-align: left;
    }
    .thumb-cap {
      position: absolute;
      inset: auto 0 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.25rem;
      padding: 0.2rem 0.4rem;
      background: rgb(30 30 30 / 0.7);
      color: #fff;
      font-size: 0.8rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .thumb-cap.is-bad {
      background: rgb(200 21 29 / 0.85);
    }
    .thumb-wait {
      position: absolute;
      inset: 0;
      border: 2px dashed var(--color-gold);
      border-radius: inherit;
      pointer-events: none;
    }
    .del {
      color: var(--color-bad);
    }
    /* Under the photo in the viewer: where it stands, and delete. */
    .view-foot {
      display: grid;
      flex: 0 0 auto;
      gap: 0.6rem;
      padding: 0.75rem 0.875rem calc(env(safe-area-inset-bottom) + 0.75rem);
      background: var(--color-panel);
      color: var(--color-text);
    }
    @media (max-height: 500px) {
      .view-foot {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        padding-block: 0.3rem;
      }
    }
    /* Remove sits on the photo's corner: a full 2.75rem target, drawn as a small dark disc. */
    .thumb-del {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      color: #fff;
    }
    .thumb-del::before {
      content: '';
      position: absolute;
      inset: 0.55rem;
      z-index: -1;
      border-radius: 9999px;
      background: rgb(30 30 30 / 0.78);
      box-shadow: 0 0 0 2px #fff;
    }
    .thumb-del:hover::before,
    .thumb-del:focus-visible::before {
      background: var(--color-bad);
    }
  `,
})
export class OrderPhotosComponent {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(WorkerStore);
  private readonly toast = inject(ToastService);

  readonly order = input.required<LocalWorkOrder>();
  readonly orderLabel = input<string>('');
  /** The order is running on this phone: photos can be taken. */
  readonly canLog = input(false);
  /** Not started yet: existing photos can be looked at, and the card says why there is no camera. */
  readonly waiting = input(false);

  protected readonly pressure = signal<number | null>(null);
  protected readonly viewing = signal<LocalPhoto | null>(null);
  protected readonly reviewFile = signal<Blob | null>(null);
  protected readonly pendingCategory = signal<PhotoCategory>('IN_PROGRESS');
  protected readonly cameraNotice = signal(false);
  private readonly prefs = inject(PrivacyPrefsService);
  protected readonly categories = PHOTO_CATEGORIES;
  protected readonly icon = PHOTO_ICON;
  private readonly session = inject(SessionStore);
  protected readonly workerName = computed(() => this.session.user()?.displayName ?? '');
  protected readonly cameraPoints = computed<readonly NoticePoint[]>(() => [
    { icon: 'camera', text: this.i18n.t('camera.noticeP1') },
    { icon: 'eye-off', text: this.i18n.t('camera.noticeP2') },
    { icon: 'shield', text: this.i18n.t('camera.noticeP3') },
  ]);
  /** Photos waiting for the review sheet: several picked from the gallery, dropped, or taken through "save and another". */
  private queue: Blob[] = [];
  private awaitingAnother = false;

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');
  private readonly gallery = viewChild.required<ElementRef<HTMLInputElement>>('gallery');
  /** Which picker the camera notice should open once accepted. */
  private wantGallery = false;
  private readonly urls = new BlobUrls();

  protected readonly suggestion = computed(() => SUGGESTED[this.order().status]);
  protected readonly mine = computed(() => this.store.photos().filter((p) => p.workOrderId === this.order().id));
  protected readonly withPreview = computed(() => this.mine().filter((p) => p.thumb || p.blob));
  /** Photos on the device by what they document, newest first. */
  protected readonly byCategory = computed(() => {
    const out = Object.fromEntries(PHOTO_CATEGORIES.map((c) => [c, [] as LocalPhoto[]])) as Record<PhotoCategory, LocalPhoto[]>;
    for (const p of [...this.withPreview()].sort((a, b) => b.createdAt - a.createdAt)) out[p.category].push(p);
    return out;
  });
  /** The order the viewer turns through: the same as on the screen. */
  protected readonly ordered = computed(() => PHOTO_CATEGORIES.flatMap((c) => this.byCategory()[c]));
  protected readonly viewIndex = computed(() => Math.max(0, this.ordered().findIndex((p) => p.id === this.viewing()?.id)));
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

  protected viewMeta(p: LocalPhoto): string {
    const where = [this.orderLabel(), this.order().siteName].filter(Boolean).join(' · ');
    return `${where} · ${this.workerName()} · ${this.i18n.date(p.createdAt)} ${this.i18n.time(p.createdAt)}`;
  }

  protected stepView(by: -1 | 1): void {
    const list = this.ordered();
    if (list.length) this.viewing.set(list[(this.viewIndex() + by + list.length) % list.length] ?? null);
  }

  protected previewUrl(p: LocalPhoto): string | null {
    return this.urls.url(p.id, p.thumb ?? p.blob);
  }

  protected fullUrl(p: LocalPhoto): string | null {
    return p.blob ? this.urls.url(`${p.id}:full`, p.blob) : this.previewUrl(p);
  }

  protected open(c: PhotoCategory): void {
    this.pendingCategory.set(c);
    this.wantGallery = false;
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
    (this.wantGallery ? this.gallery() : this.picker()).nativeElement.click();
  }

  protected picked(event: Event): void {
    const el = event.target as HTMLInputElement;
    const files = [...(el.files ?? [])];
    el.value = '';
    if (!files.length) {
      this.awaitingAnother = false;
      return;
    }
    this.enqueue(files);
  }

  private enqueue(files: readonly Blob[]): void {
    if (this.awaitingAnother && this.reviewFile()) {
      this.queue.push(...files);
      return;
    }
    this.awaitingAnother = false;
    const [first, ...rest] = files;
    this.queue.push(...rest);
    if (this.reviewFile()) this.queue.unshift(...(first ? [first] : []));
    else this.reviewFile.set(first ?? null);
  }

  protected another(category: PhotoCategory): void {
    this.pendingCategory.set(category);
    this.awaitingAnother = true;
    this.picker().nativeElement.click();
  }

  protected reviewDone(): void {
    const next = this.queue.shift() ?? null;
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
    this.queue = [];
    this.reviewFile.set(null);
  }


  /** Existing photos from the phone's gallery, several at once. */
  protected fromGallery(): void {
    this.pendingCategory.set(this.suggestion());
    this.wantGallery = true;
    if (!this.prefs.cameraNoticeSeen()) {
      this.cameraNotice.set(true);
      return;
    }
    this.gallery().nativeElement.click();
  }
  /** Own photos can go until the day's report is submitted; after that they belong to what the manager signs. */
  protected readonly canDelete = computed(() => !this.store.dayClosed());
  protected readonly removing = signal<LocalPhoto | null>(null);
  protected readonly removeBusy = signal(false);
  protected readonly removeError = signal<string | null>(null);

  protected askRemove(p: LocalPhoto): void {
    this.removeError.set(null);
    this.removing.set(p);
  }

  protected async remove(p: LocalPhoto): Promise<void> {
    if (this.removeBusy()) return;
    this.removeBusy.set(true);
    this.removeError.set(null);
    try {
      await this.store.deletePhoto(p.id);
      this.removing.set(null);
      this.viewing.set(null);
      this.toast.show(this.i18n.t('photo.deleted'));
    } catch (err: unknown) {
      this.removeError.set(workflowMessage(this.i18n, err));
    } finally {
      this.removeBusy.set(false);
    }
  }
}
