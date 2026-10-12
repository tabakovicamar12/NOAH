import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
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
  host: { class: 'relative inline-block', '(document:pointerdown)': 'onOutside($event)', '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <button
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

    @if (open()) {
      <div
        id="aon-net-panel"
        role="dialog"
        [attr.aria-label]="i18n.t('more.sync')"
        class="absolute z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] border-2 border-charcoal bg-stock p-4 text-ink shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35)]"
        [class.right-0]="align() === 'end'"
        [class.left-0]="align() === 'start'"
        [class.bottom-full]="placement() === 'top'"
        [class.mb-2]="placement() === 'top'"
      >
        <p class="font-cond text-2xl leading-tight">{{ stateLabel() }}</p>
        <p class="mt-1 text-sm text-ink-muted">
          {{ sync.lastSyncAt() ? i18n.t('net.lastSync', { time: i18n.time(sync.lastSyncAt()) }) : i18n.t('net.neverSynced') }}
        </p>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div class="border-2 border-charcoal px-3 py-2">
            <dt class="label-caps text-ink-muted">{{ i18n.t('net.pending', { n: '' }) }}</dt>
            <dd class="font-cond text-3xl">{{ sync.pendingCount() }}</dd>
          </div>
          <div class="border-2 px-3 py-2" [class]="sync.failedItems().length ? 'border-hold text-hold-ink' : 'border-charcoal'">
            <dt class="label-caps">{{ i18n.t('net.failed', { n: '' }) }}</dt>
            <dd class="font-cond text-3xl">{{ sync.failedItems().length }}</dd>
          </div>
        </dl>
        @if (sync.unsyncedCount() === 0) {
          <p class="mt-3 flex items-center gap-2 text-sm font-semibold"><aon-icon name="circle-check" [size]="18" class="text-done" />{{ i18n.t('net.allSynced') }}</p>
        }
        @if (network.simulatedOffline()) {
          <p class="mt-3 text-sm font-semibold text-hold-ink">{{ i18n.t('more.simulateOffline') }} · {{ i18n.t('net.simulated') }}</p>
        }
        <button
          type="button"
          class="mt-4 flex min-h-12 w-full items-center justify-center gap-2 bg-charcoal px-4 font-cond text-lg text-white disabled:opacity-50"
          [disabled]="!network.online() || sync.phase() === 'SYNCING'"
          (click)="sync.syncNow()"
        >
          <aon-icon name="refresh" [size]="20" />
          {{ i18n.t('net.syncNow') }}
        </button>
      </div>
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
  protected readonly open = signal(false);

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
