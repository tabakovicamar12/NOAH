import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { NetworkStatusComponent } from '../../shared/ui/network-status.component';

interface NavItem {
  readonly path: string;
  readonly label: TranslationKey;
  readonly icon: IconName;
}

/** Site-manager shell: charcoal rail with the gold active item and network state at its foot. */
@Component({
  selector: 'aon-manager-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, LanguageSwitchComponent, LogoComponent, NetworkStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      href="#mgr-main"
      class="sr-only z-[70] bg-gold px-4 py-3 font-cond text-lg text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2 no-print"
      >{{ i18n.t('common.skipToContent') }}</a
    >
    <div class="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] print:block">
      <aside class="no-print sticky top-0 z-40 flex flex-col bg-charcoal text-white lg:h-dvh">
        <div class="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:py-5">
          <aon-logo [size]="1.875" />
          <div class="flex items-center gap-2 lg:hidden">
            <aon-network-status [onDark]="true" />
            <button
              type="button"
              class="grid min-h-12 min-w-12 place-items-center ring-2 ring-inset ring-white/40 disabled:opacity-50"
              [attr.aria-label]="i18n.t('common.logout')"
              [disabled]="busy()"
              (click)="logout()"
            >
              <aon-icon name="logout" [size]="20" />
            </button>
          </div>
        </div>

        <nav [attr.aria-label]="i18n.t('mgr.nav')" class="flex overflow-x-auto lg:block lg:overflow-visible">
          <ul class="flex lg:block">
            @for (item of nav; track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  routerLinkActive="is-active"
                  [routerLinkActiveOptions]="{ exact: true }"
                  #rla="routerLinkActive"
                  [attr.aria-current]="rla.isActive ? 'page' : null"
                  class="rail-link flex min-h-12 items-center gap-3 whitespace-nowrap px-4 font-cond text-lg text-on-dark-muted no-underline lg:min-h-14 lg:px-5"
                >
                  <aon-icon [name]="item.icon" [size]="22" />{{ i18n.t(item.label) }}
                </a>
              </li>
            }
          </ul>
        </nav>

        <div class="mt-auto hidden border-t-2 border-charcoal-deep px-5 py-4 lg:block">
          <aon-network-status [onDark]="true" align="start" placement="top" />
          <p class="mt-4 font-semibold leading-tight">{{ session.user()?.displayName }}</p>
          <p class="text-sm text-on-dark-muted">{{ i18n.t('login.roleManager') }}</p>
          <div class="mt-3 flex items-center gap-2">
            <aon-language-switch [onDark]="true" />
            <button
              type="button"
              class="grid min-h-12 min-w-12 place-items-center ring-2 ring-inset ring-white/40 disabled:opacity-50"
              [attr.aria-label]="i18n.t('common.logout')"
              [title]="i18n.t('common.logout')"
              [disabled]="busy()"
              (click)="logout()"
            >
              <aon-icon name="logout" [size]="20" />
            </button>
          </div>
        </div>
      </aside>

      <main id="mgr-main" tabindex="-1" class="min-w-0 outline-none">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .rail-link:hover {
      color: #fff;
      background: var(--color-charcoal-deep);
    }
    .rail-link.is-active {
      color: var(--color-ink);
      background: var(--color-gold);
    }
  `,
})
export class ManagerShellComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly busy = signal(false);

  protected readonly nav: readonly NavItem[] = [
    { path: '/m', label: 'mgr.navOverview', icon: 'grid' },
    { path: '/m/projects', label: 'mgr.navProjects', icon: 'list' },
    { path: '/m/orders/new', label: 'mgr.navNewOrder', icon: 'plus' },
    { path: '/m/report', label: 'mgr.navPdf', icon: 'printer' },
  ];

  protected async logout(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } catch (err: unknown) {
      console.error('[AON] logout failed', err);
      this.toast.error(this.i18n.t('common.errorGeneric'));
    } finally {
      this.busy.set(false);
    }
  }
}
