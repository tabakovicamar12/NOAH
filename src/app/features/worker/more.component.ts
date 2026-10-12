import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { SyncOperationType } from '../../core/models/sync.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { PrivacyPrefsService } from '../../core/privacy/privacy-prefs.service';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { SyncEngine } from '../../core/sync/sync-engine.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';

@Component({
  selector: 'aon-worker-more',
  imports: [RouterLink, IconComponent, LanguageSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid gap-6 px-4 pb-8 pt-4">
      <h1 class="font-cond text-4xl">{{ i18n.t('more.title') }}</h1>

      <section class="border-2 border-charcoal bg-stock px-4 py-4" aria-labelledby="acc-title">
        <h2 id="acc-title" class="label-caps text-ink-muted">{{ i18n.t('more.account') }}</h2>
        <p class="mt-1 font-cond text-2xl leading-tight">{{ session.user()?.displayName }}</p>
        <p class="text-ink-muted">
          {{ i18n.t('more.role', { role: i18n.t('login.roleWorker') }) }}
          @if (session.user()?.crew; as crew) {
            · {{ crew }}
          }
        </p>
        <div class="mt-4 flex items-center justify-between gap-3">
          <span class="label-caps">{{ i18n.t('common.language') }}</span>
          <aon-language-switch />
        </div>
      </section>

      <section class="border-2 border-charcoal bg-stock px-4 py-4" aria-labelledby="voice-title">
        <h2 id="voice-title" class="flex items-center gap-2 font-cond text-xl"><aon-icon name="mic" [size]="20" />{{ i18n.t('voice.settingTitle') }}</h2>
        @if (prefs.voiceConsent(); as c) {
          <p class="mt-1 text-[0.95rem]">{{ i18n.t('voice.settingOn', { date: i18n.date(c.at) }) }}</p>
          <button
            type="button"
            class="mt-3 flex min-h-14 w-full items-center justify-center gap-2 font-cond text-lg ring-2 ring-inset ring-charcoal"
            (click)="withdrawVoice()"
          >
            <aon-icon name="x" [size]="20" />{{ i18n.t('voice.withdraw') }}
          </button>
        } @else {
          <p class="mt-1 text-[0.95rem] text-ink-muted">{{ i18n.t('voice.settingOff') }}</p>
        }
      </section>

      <section aria-labelledby="sync-title">
        <h2 id="sync-title" class="font-cond text-2xl">{{ i18n.t('more.sync') }}</h2>
        <div class="mt-2 grid grid-cols-2 border-2 border-charcoal bg-stock">
          <div class="border-r-2 border-charcoal px-4 py-3">
            <p class="label-caps text-ink-muted">{{ i18n.t('net.pending', { n: '' }) }}</p>
            <p class="font-cond text-4xl leading-none">{{ sync.pendingCount() }}</p>
          </div>
          <div class="px-4 py-3" [class]="sync.failedItems().length ? 'bg-hold text-white' : ''">
            <p class="label-caps" [class.text-ink-muted]="!sync.failedItems().length">{{ i18n.t('net.failed', { n: '' }) }}</p>
            <p class="font-cond text-4xl leading-none">{{ sync.failedItems().length }}</p>
          </div>
        </div>
        <p class="mt-2 text-[0.95rem] text-ink-muted">
          {{ sync.lastSyncAt() ? i18n.t('net.lastSync', { time: i18n.time(sync.lastSyncAt()) }) : i18n.t('net.neverSynced') }}
        </p>

        @if (sync.failedItems().length) {
          <h3 class="mt-4 font-cond text-xl">{{ i18n.t('more.failedTitle') }}</h3>
          <p class="text-[0.95rem] text-ink-muted">{{ i18n.t('more.failedHint') }}</p>
          <ul class="mt-2 grid gap-2">
            @for (item of sync.failedItems(); track item.opId) {
              <li class="border-2 border-hold bg-stock px-4 py-3">
                <p class="font-bold">{{ i18n.t(opKey(item.op.type)) }} · {{ i18n.time(item.createdAt) }}</p>
                @if (item.lastError) {
                  <p class="mt-0.5 break-words text-sm text-hold-ink">{{ item.lastError }}</p>
                }
                <div class="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" class="flex min-h-14 items-center justify-center gap-2 bg-charcoal font-cond text-lg text-white" (click)="retry(item.seq)">
                    <aon-icon name="retry" [size]="20" />{{ i18n.t('common.retry') }}
                  </button>
                  <button type="button" class="flex min-h-14 items-center justify-center gap-2 font-cond text-lg ring-2 ring-inset ring-charcoal" (click)="discard(item.seq)">
                    <aon-icon name="trash" [size]="20" />{{ i18n.t('common.discard') }}
                  </button>
                </div>
              </li>
            }
          </ul>
        }

        <button
          type="button"
          class="mt-3 flex min-h-14 w-full items-center justify-center gap-2 bg-charcoal font-cond text-xl text-white disabled:opacity-50"
          [disabled]="!network.online() || sync.phase() === 'SYNCING'"
          (click)="sync.syncNow()"
        >
          <aon-icon name="refresh" [size]="22" />{{ i18n.t('net.syncNow') }}
        </button>
      </section>

      <!-- Offline simulation is a presentation aid; a real crew should never switch its sync off by accident. -->
      @if (demo || network.simulatedOffline()) {
        <label class="flex cursor-pointer items-start gap-3 border-2 border-dashed border-charcoal px-4 py-4">
          <input type="checkbox" class="aon-check mt-0.5" [checked]="network.simulatedOffline()" (change)="toggleOffline($event)" />
          <span>
            <span class="block font-cond text-xl leading-tight">{{ i18n.t('more.simulateOffline') }}</span>
            <span class="block text-[0.95rem] text-ink-muted">{{ i18n.t('more.simulateHint') }}</span>
          </span>
        </label>
      }

      <div class="grid gap-2">
        <a routerLink="/privacy" class="flex min-h-14 items-center justify-between border-2 border-charcoal bg-stock px-4 font-cond text-xl text-ink no-underline">
          {{ i18n.t('more.privacy') }}<aon-icon name="chevron-right" [size]="24" />
        </a>
        <button
          type="button"
          class="flex min-h-14 items-center justify-between px-4 font-cond text-xl ring-2 ring-inset ring-charcoal disabled:opacity-50"
          [disabled]="busy()"
          (click)="logout()"
        >
          {{ i18n.t('common.logout') }}<aon-icon name="logout" [size]="24" />
        </button>
      </div>
    </div>
  `,
})
export class MoreComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly session = inject(SessionStore);
  protected readonly sync = inject(SyncEngine);
  protected readonly network = inject(NetworkStatusService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly busy = signal(false);
  protected readonly prefs = inject(PrivacyPrefsService);
  protected readonly demo = DEMO_MODE;

  protected async withdrawVoice(): Promise<void> {
    await this.safely(() => this.prefs.withdrawVoice());
    this.toast.success(this.i18n.t('voice.withdrawn'));
  }

  protected opKey(type: SyncOperationType): `opType.${SyncOperationType}` {
    return `opType.${type}`;
  }

  protected toggleOffline(event: Event): void {
    this.network.setSimulatedOffline((event.target as HTMLInputElement).checked);
  }

  protected async retry(seq: number | undefined): Promise<void> {
    if (seq === undefined) return;
    await this.safely(() => this.sync.retry(seq));
  }

  protected async discard(seq: number | undefined): Promise<void> {
    if (seq === undefined) return;
    await this.safely(() => this.sync.discard(seq));
  }

  protected async logout(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this.safely(async () => {
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    });
    this.busy.set(false);
  }

  private async safely(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err: unknown) {
      console.error('[AON] action failed', err);
      this.toast.error(this.i18n.t('common.errorGeneric'));
    }
  }
}
