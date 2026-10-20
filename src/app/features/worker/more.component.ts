import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { SyncOperationType } from '../../core/models/sync.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { SyncEngine } from '../../core/sync/sync-engine.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { initialsOf } from '../manager/person';

@Component({
  selector: 'aon-worker-more',
  imports: [RouterLink, IconComponent, LanguageSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-page">
      <h1 class="w-h1">{{ i18n.t('more.title') }}</h1>

      <div class="w-stack mt-3">
        <section class="w-card" aria-labelledby="acc-title">
          <h2 id="acc-title" class="sr-only">{{ i18n.t('more.account') }}</h2>
          <div class="who">
            <span class="avatar" aria-hidden="true">{{ initials() }}</span>
            <span class="min-w-0">
              <span class="block font-semibold">{{ session.user()?.displayName }}</span>
              <span class="w-small w-muted block">
                {{ i18n.t('more.role', { role: i18n.t('login.roleWorker') }) }}
                @if (session.user()?.crew; as crew) {
                  · {{ crew }}
                }
              </span>
            </span>
          </div>
          <div class="w-rule"></div>
          <div class="flex items-center justify-between gap-3">
            <span>{{ i18n.t('common.language') }}</span>
            <aon-language-switch />
          </div>
        </section>

        <section class="w-card" aria-labelledby="sync-title">
          <h2 id="sync-title" class="w-h2">
            {{ i18n.t('more.sync') }}
            <small>{{ sync.lastSyncAt() ? i18n.t('net.lastSync', { time: i18n.time(sync.lastSyncAt()) }) : i18n.t('net.neverSynced') }}</small>
          </h2>
          <dl class="w-stats mt-2.5">
            <div>
              <dt>{{ i18n.t('net.pending', { n: '' }) }}</dt>
              <dd>{{ sync.pendingCount() }}</dd>
            </div>
            <div>
              <dt>{{ i18n.t('net.failed', { n: '' }) }}</dt>
              <dd [class.bad]="sync.failedItems().length">{{ sync.failedItems().length }}</dd>
            </div>
          </dl>

          @if (sync.failedItems().length) {
            <div class="w-rule"></div>
            <h3 class="font-semibold">{{ i18n.t('more.failedTitle') }}</h3>
            <p class="w-small w-muted">{{ i18n.t('more.failedHint') }}</p>
            <ul class="mt-2 grid gap-2">
              @for (item of sync.failedItems(); track item.opId) {
                <li class="failed">
                  <p class="font-semibold">{{ i18n.t(opKey(item.op.type)) }} · {{ i18n.time(item.createdAt) }}</p>
                  @if (item.lastError) {
                    <p class="w-small mt-0.5 break-words text-[var(--color-bad-ink)]">{{ item.lastError }}</p>
                  }
                  <div class="w-pair mt-2.5">
                    <button type="button" class="w-btn w-btn-dark" (click)="retry(item.seq)">
                      <aon-icon name="retry" [size]="18" />{{ i18n.t('common.retry') }}
                    </button>
                    <button type="button" class="w-btn w-btn-line" (click)="discard(item.seq)">
                      <aon-icon name="trash" [size]="18" />{{ i18n.t('common.discard') }}
                    </button>
                  </div>
                </li>
              }
            </ul>
          }

          @if (sync.retryingItems().length) {
            <div class="w-rule"></div>
            <h3 class="font-semibold">{{ i18n.t('more.retryingTitle') }}</h3>
            <p class="w-small w-muted">{{ i18n.t('more.retryingHint') }}</p>
            <ul class="mt-2 grid gap-2">
              @for (item of sync.retryingItems(); track item.opId) {
                <li class="retrying">
                  <p class="font-semibold">{{ i18n.t(opKey(item.op.type)) }} · {{ i18n.time(item.createdAt) }}</p>
                  <p class="w-small mt-0.5 break-words">{{ item.lastError }}</p>
                  <p class="w-small w-muted mt-0.5">{{ i18n.t('more.attempts', { n: item.attempts }) }}</p>
                </li>
              }
            </ul>
          }
          <button
            type="button"
            class="w-btn w-btn-soft mt-3"
            [disabled]="!network.online() || sync.phase() === 'SYNCING'"
            (click)="sync.syncNow()"
          >
            <aon-icon name="refresh" [size]="18" />{{ i18n.t('net.syncNow') }}
          </button>
        </section>

        <!-- Offline simulation is a presentation aid; a real crew should never switch its sync off by accident. -->
        @if (demo || network.simulatedOffline()) {
          <label class="w-card sim">
            <input type="checkbox" class="aon-check mt-0.5" [checked]="network.simulatedOffline()" (change)="toggleOffline($event)" />
            <span>
              <span class="block font-semibold">{{ i18n.t('more.simulateOffline') }}</span>
              <span class="w-small w-muted block">{{ i18n.t('more.simulateHint') }}</span>
            </span>
          </label>
        }

        <ul class="w-list">
          <li>
            <a routerLink="/w/hours" class="w-row"><span class="inline-flex items-center gap-2"><aon-icon name="clock" [size]="18" />{{ i18n.t('more.hours') }}</span><aon-icon name="chevron-right" [size]="18" class="w-muted" /></a>
          </li>
          <li>
            <a routerLink="/privacy" class="w-row">{{ i18n.t('more.privacy') }}<aon-icon name="chevron-right" [size]="18" class="w-muted" /></a>
          </li>
          <li>
            <button type="button" class="w-row w-full text-left" [disabled]="busy()" (click)="logout()">
              {{ i18n.t('common.logout') }}<aon-icon name="logout" [size]="18" class="w-muted" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .avatar {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 9999px;
      background: var(--color-field);
      font-weight: 500;
    }
    .w-stats dd.bad {
      color: var(--color-bad);
    }
    .failed {
      padding: 0.7rem 0.75rem;
      border: 1px solid #ef9a9a;
      border-radius: 0.6rem;
    }
    .retrying {
      padding: 0.6rem 0.75rem;
      border-radius: 0.6rem;
      background: var(--color-gold-tint);
    }
    .sim {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      cursor: pointer;
    }
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
  protected readonly demo = DEMO_MODE;
  protected readonly initials = computed(() => initialsOf(this.session.user()?.displayName ?? ''));

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
