import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { NetworkStatusComponent } from '../../shared/ui/network-status.component';
import { WorkerStore } from './data/worker-store.service';

interface Tab {
  readonly path: string;
  readonly label: TranslationKey;
  readonly icon: IconName;
  readonly exact: boolean;
}

/** Field shell: charcoal bar with the sync badge on top, glove-sized tab bar in the thumb zone. */
@Component({
  selector: 'aon-worker-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, LogoComponent, NetworkStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      href="#worker-main"
      class="sr-only z-[70] bg-gold px-4 py-3 font-cond text-lg text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >{{ i18n.t('common.skipToContent') }}</a
    >
    <div class="mx-auto flex min-h-dvh max-w-xl flex-col bg-ground">
      <header
        class="sticky top-0 z-40 flex items-center justify-between gap-3 bg-charcoal px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-white"
      >
        <aon-logo [size]="1.75" />
        <aon-network-status [onDark]="true" />
      </header>

      <main id="worker-main" tabindex="-1" class="flex-1 outline-none">
        <router-outlet />
      </main>

      <nav
        class="sticky bottom-0 z-40 grid grid-cols-3 bg-charcoal pb-[env(safe-area-inset-bottom)] text-white"
        [attr.aria-label]="i18n.t('worker.mainNav')"
      >
        @for (tab of tabs; track tab.path) {
          <a
            [routerLink]="tab.path"
            routerLinkActive="is-active"
            [routerLinkActiveOptions]="{ exact: tab.exact }"
            #rla="routerLinkActive"
            [attr.aria-current]="rla.isActive ? 'page' : null"
            class="tab relative flex min-h-16 items-center justify-center gap-2.5 font-cond text-xl text-on-dark-muted no-underline"
          >
            <aon-icon [name]="tab.icon" [size]="24" [stroke]="2.5" />
            {{ i18n.t(tab.label) }}
          </a>
        }
      </nav>
    </div>
  `,
  styles: `
    .tab.is-active {
      color: #fff;
      background: var(--color-charcoal-deep);
    }
    .tab.is-active::before {
      content: '';
      position: absolute;
      inset: 0 0 auto;
      height: 5px;
      background: var(--color-gold);
    }
  `,
})
export class WorkerShellComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(WorkerStore);

  protected readonly tabs: readonly Tab[] = [
    { path: '/w/orders', label: 'worker.tabOrders', icon: 'clipboard', exact: false },
    { path: '/w/day', label: 'worker.tabDay', icon: 'file', exact: true },
    { path: '/w/more', label: 'worker.tabMore', icon: 'menu', exact: true },
  ];

  ngOnInit(): void {
    void this.store.refreshFromServer();
  }
}
