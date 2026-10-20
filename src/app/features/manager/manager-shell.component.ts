import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { DEMO_MODE } from '../../core/ui/demo-mode';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { NetworkStatusComponent } from '../../shared/ui/network-status.component';
import { ManagerStore } from './data/manager-store.service';

interface NavItem {
  readonly id: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly label: TranslationKey;
  readonly icon: IconName;
}

/**
 * Site-manager shell: a charcoal sidebar with the product mark, the five places a manager works,
 * the projects and their objects, and the signed-in manager at its foot.
 */
@Component({
  selector: 'aon-manager-shell',
  imports: [RouterOutlet, RouterLink, IconComponent, LanguageSwitchComponent, NetworkStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mgr-ui', '(document:keydown.escape)': 'menu.set(false)' },
  template: `
    <a href="#mgr-main" class="skip no-print">{{ i18n.t('common.skipToContent') }}</a>

    <div class="frame">
      <aside class="side no-print" [attr.aria-label]="i18n.t('mgr.nav')">
        <div class="brand">
          <a routerLink="/m" class="brand-mark">AON&nbsp;<span class="brand-dot">·</span>&nbsp;<span class="brand-noah">NOAH</span></a>
          <span class="brand-switch" aria-hidden="true"><aon-icon name="chevron-up" [size]="16" [stroke]="2" /><aon-icon name="chevron-down" [size]="16" [stroke]="2" /></span>
          <button
            type="button"
            class="menu-btn"
            [attr.aria-expanded]="mobileNav()"
            aria-controls="mgr-nav"
            [attr.aria-label]="i18n.t('mgr.nav')"
            (click)="mobileNav.set(!mobileNav())"
          >
            <aon-icon [name]="mobileNav() ? 'x' : 'menu'" [size]="24" [stroke]="1.8" />
          </button>
        </div>

        <nav id="mgr-nav" class="nav" [class.is-open]="mobileNav()" (click)="mobileNav.set(false)">
          <ul>
            @for (item of navItems(); track item.id) {
              @let active = activeNav() === item.id;
              <li>
                <a
                  class="nav-link"
                  [class.is-active]="active"
                  [routerLink]="item.path"
                  [queryParams]="item.query ?? null"
                  [attr.aria-current]="active ? 'page' : null"
                >
                  <aon-icon [name]="item.icon" [size]="22" [stroke]="1.6" />
                  <span>{{ i18n.t(item.label) }}</span>
                  @if (item.id === 'review' && store.toReview().length) {
                    <span class="nav-count" [attr.aria-label]="i18n.t('mgr.navReviewAria', { n: store.toReview().length })">{{ store.toReview().length }}</span>
                  }
                </a>
              </li>
            }
          </ul>
        </nav>

        <section class="projects pd" [attr.aria-label]="i18n.t('mgr.treeLabel')">
          <div class="pd-head">
            <h2 class="pd-label">{{ i18n.t('mgr.navProjects') }}</h2>
            <a class="pd-all" routerLink="/m/projects">{{ i18n.t('mgr.treeAllProjects') }}</a>
          </div>
          @if (projects().length > 6) {
            <label class="pd-find">
              <span class="sr-only">{{ i18n.t('mgr.treeFind') }}</span>
              <aon-icon name="search" [size]="13" [stroke]="2" />
              <input type="search" [placeholder]="i18n.t('mgr.treeFind')" [value]="treeQuery()" (input)="treeQuery.set($any($event.target).value)" />
            </label>
          }
          <ul class="pd-list">
            @for (p of treeShown(); track p.id) {
              @let on = scope().project === p.id || siteIn(p.sites);
              <li [class.is-on]="on">
                <a class="pd-row" routerLink="/m" [queryParams]="{ project: p.id }" [attr.aria-current]="scope().project === p.id ? 'page' : null">
                  <span class="pd-dot" [class.is-bad]="p.issues > 0" [class.is-open]="!p.issues && p.open > 0" aria-hidden="true"></span>
                  <span class="pd-name">{{ p.name }}</span>
                  @if (p.open) {
                    <span class="pd-n" aria-hidden="true">{{ p.open }}</span>
                  }
                  <span class="sr-only">{{ i18n.t('mgr.treeOrders', { n: p.open }) }}@if (p.issues) {, {{ i18n.t('mgr.treeIssues', { n: p.issues }) }}}</span>
                </a>
                @if (on && p.sites.length > 1) {
                  <div class="pd-sites">
                    @for (s of p.sites; track s.id) {
                      <a routerLink="/m" [queryParams]="{ site: s.id }" [class.is-on]="scope().site === s.id" [attr.aria-current]="scope().site === s.id ? 'page' : null">{{ s.name }}</a>
                    }
                  </div>
                }
              </li>
            } @empty {
              <li class="pd-none">{{ i18n.t('mgr.noResults') }}</li>
            }
          </ul>
          @if (treeHidden() > 0) {
            <button type="button" class="pd-more" (click)="treeAll.set(true)">{{ i18n.t('mgr.treeMore', { n: treeHidden() }) }}</button>
          }
        </section>

        <div class="me">
          @if (demo) {
            <img src="/plates/avatar-rail.png" [alt]="i18n.t('mgr.avatarAlt')" width="56" height="56" class="me-avatar" />
          } @else {
            <span class="me-avatar me-initials" aria-hidden="true">{{ initials() }}</span>
          }
          <p class="me-name">
            <span class="block">{{ session.user()?.displayName }},</span>
            <span class="me-role">{{ i18n.t(roleLabel()) }}</span>
          </p>
          <div class="relative">
            <button
              type="button"
              class="me-menu"
              [attr.aria-expanded]="menu()"
              aria-controls="mgr-account"
              [attr.aria-label]="i18n.t('mgr.settingsTitle')"
              (click)="menu.set(!menu())"
            >
              <aon-icon name="chevron-down" [size]="20" [stroke]="1.8" />
            </button>
            @if (menu()) {
              <div id="mgr-account" role="dialog" [attr.aria-label]="i18n.t('mgr.settingsTitle')" class="account">
                <aon-network-status variant="pill" [onDark]="false" align="start" placement="top" />
                <div class="mt-3"><aon-language-switch /></div>
                <button type="button" class="account-out" [disabled]="busy()" (click)="logout()">
                  <aon-icon name="logout" [size]="18" />{{ i18n.t('common.logout') }}
                </button>
              </div>
            }
          </div>
        </div>
      </aside>

      @if (mobileNav()) {
        <div class="nav-scrim" aria-hidden="true" (click)="mobileNav.set(false)"></div>
      }
      <main id="mgr-main" tabindex="-1" class="main">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      background: var(--color-site);
      color: var(--color-text);
      font-family: var(--font-ui);
      --side-w: 16.9rem;
    }
    .skip {
      position: absolute;
      left: -999px;
      z-index: 80;
      padding: 0.75rem 1rem;
      background: var(--color-gold);
      font-weight: 600;
    }
    .skip:focus {
      left: 0.5rem;
      top: 0.5rem;
    }
    .frame {
      display: grid;
      grid-template-columns: var(--side-w) minmax(0, 1fr);
      min-height: 100dvh;
    }
    .side {
      position: sticky;
      top: 0;
      z-index: 40;
      display: flex;
      flex-direction: column;
      height: 100dvh;
      padding: 0 0.85rem;
      background: var(--color-rail);
      color: var(--color-rail-text);
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 5.4rem;
      padding: 0 0.9rem 0 0.85rem;
    }
    .brand-mark {
      font-size: 1.56rem;
      font-weight: 500;
      letter-spacing: 0.01em;
      color: #fff;
      text-decoration: none;
    }
    .brand-dot {
      color: var(--color-rail-muted);
    }
    .brand-noah {
      color: var(--color-gold);
    }
    .brand-switch {
      display: grid;
      color: var(--color-rail-muted);
      line-height: 0;
    }
    .brand-switch aon-icon + aon-icon {
      margin-top: -0.35rem;
    }
    .menu-btn {
      display: none;
    }
    .nav ul {
      display: grid;
      gap: 0.55rem;
      margin-top: 0.6rem;
    }
    .nav-link:focus-visible,
    .pd-all:focus-visible,
    .pd-row:focus-visible,
    .pd-sites a:focus-visible,
    .pd-more:focus-visible,
    .me-menu:focus-visible,
    .menu-btn:focus-visible {
      outline: 2px solid var(--color-gold);
      outline-offset: 2px;
      box-shadow: none;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      min-height: 2.3rem;
      padding: 0.25rem 0.8rem;
      border-radius: 0.5rem;
      color: var(--color-rail-text);
      font-size: 1.08rem;
      text-decoration: none;
      transition: background-color 160ms var(--ease-out-expo), color 160ms var(--ease-out-expo);
    }
    .nav-link:hover {
      background: var(--color-rail-hover);
    }
    .nav-link.is-active {
      min-height: 2.75rem;
      background: var(--color-rail-active);
      color: var(--color-gold);
    }
    .nav-count {
      margin-left: auto;
      min-width: 1.5rem;
      padding: 0 0.45rem;
      border-radius: 9999px;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-size: 0.8rem;
      font-weight: 600;
      line-height: 1.5rem;
      text-align: center;
    }
    /* Project list in the rail: a status dot, the name, open orders. */
    .pd {
      margin-top: 1.4rem;
      padding: 1.1rem 0.8rem 0;
      border-top: 1px solid var(--color-rail-rule);
    }
    .pd-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0 0.45rem;
    }
    .pd-label {
      flex: 1 1 auto;
      color: var(--color-rail-muted);
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .pd-all {
      color: var(--color-rail-muted);
      font-size: 0.8rem;
      text-decoration: none;
    }
    .pd-all:hover {
      color: var(--color-gold);
    }
    .pd-list {
      display: grid;
      gap: 0;
      margin-top: 0.45rem;
    }
    .pd-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-height: 2.15rem;
      padding: 0 0.45rem;
      border-radius: 0.4rem;
      color: var(--color-rail-text);
      font-size: 0.93rem;
      text-decoration: none;
    }
    .pd-row:hover {
      background: var(--color-rail-hover);
    }
    li.is-on > .pd-row {
      color: var(--color-gold);
    }
    .pd-dot {
      flex: 0 0 auto;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      box-shadow: inset 0 0 0 1.5px var(--color-rail-muted);
    }
    .pd-dot.is-open {
      background: var(--color-gold);
      box-shadow: none;
    }
    .pd-dot.is-bad {
      background: #ef5350;
      box-shadow: 0 0 0 3px rgb(239 83 80 / 0.18);
    }
    .pd-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pd-n {
      flex: 0 0 auto;
      color: var(--color-rail-muted);
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }
    .pd-sites {
      display: grid;
      margin: 0 0 0.3rem 1.55rem;
    }
    .pd-sites a {
      padding: 0.22rem 0;
      color: var(--color-rail-muted);
      font-size: 0.85rem;
      text-decoration: none;
    }
    .pd-sites a:hover, .pd-sites a.is-on {
      color: var(--color-gold);
    }
    .pd-find {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0.5rem 0.45rem 0;
      padding-bottom: 0.3rem;
      border-bottom: 1px solid var(--color-rail-rule);
      color: var(--color-rail-muted);
    }
    .pd-find:focus-within {
      border-color: var(--color-gold);
    }
    .pd-find input {
      width: 100%;
      min-width: 0;
      background: transparent;
      color: var(--color-rail-text);
      font-size: 0.86rem;
      outline: none;
    }
    .pd-more {
      margin-top: 0.2rem;
      padding: 0.3rem 0.45rem;
      color: var(--color-rail-muted);
      font-size: 0.8rem;
    }
    .pd-more:hover {
      color: var(--color-gold);
    }
    .pd-none {
      padding: 0.45rem;
      color: var(--color-rail-muted);
      font-size: 0.86rem;
    }
    .me {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-top: auto;
      padding: 1.1rem 0.8rem 1.25rem;
      border-top: 1px solid var(--color-rail-rule);
    }
    .me-avatar {
      width: 2.55rem;
      height: 2.55rem;
      flex: 0 0 auto;
      border-radius: 9999px;
      object-fit: cover;
    }
    .me-initials {
      display: grid;
      place-items: center;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 600;
    }
    .me-name {
      flex: 1 1 auto;
      min-width: 0;
      white-space: nowrap;
      font-size: 1.08rem;
      font-weight: 500;
      line-height: 1.3;
      color: #fff;
    }
    .me-role {
      display: block;
      font-weight: 400;
      color: var(--color-rail-muted);
    }
    .me-menu {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.45rem;
      color: var(--color-rail-muted);
    }
    .me-menu:hover {
      background: var(--color-rail-hover);
      color: #fff;
    }
    .account {
      position: absolute;
      left: calc(100% + 0.75rem);
      bottom: 0;
      z-index: 60;
      width: 17rem;
      padding: 1rem;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      color: var(--color-text);
      box-shadow: 0 16px 40px -16px rgb(20 20 20 / 0.35);
    }
    .account-out {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-height: 2.6rem;
      margin-top: 0.9rem;
      border-radius: 0.5rem;
      border: 1px solid var(--color-line-strong);
      font-weight: 500;
    }
    .account-out:hover {
      background: var(--color-field);
    }
    .main {
      min-width: 0;
      outline: none;
    }
    .nav-scrim {
      position: fixed;
      inset: 0;
      z-index: 35;
      background: rgb(42 41 41 / 0.4);
    }
    /* Phones and narrow tablets: a compact top bar; the five destinations open as a sheet under it. */
    @media (max-width: 900px) {
      .frame {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
        align-content: start;
      }
      .side {
        height: auto;
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        padding: 0 0.5rem 0 0.25rem;
      }
      .brand {
        height: 3.5rem;
        flex: 1 1 auto;
        gap: 0.5rem;
        justify-content: flex-start;
      }
      .brand-mark {
        font-size: 1.3rem;
      }
      .brand-switch,
      .projects,
      .me-name {
        display: none;
      }
      .menu-btn {
        display: grid;
        place-items: center;
        order: -1;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 0.5rem;
        color: #fff;
      }
      .nav {
        display: none;
      }
      .nav.is-open {
        display: block;
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        padding: 0.5rem 0.75rem 1rem;
        background: var(--color-rail);
        box-shadow: 0 18px 30px -18px rgb(0 0 0 / 0.6);
      }
      .nav.is-open ul {
        margin-top: 0;
        gap: 0.2rem;
      }
      .nav-link {
        min-height: 3rem;
      }
      .nav-link.is-active {
        min-height: 3rem;
      }
      .me {
        margin-top: 0;
        margin-left: auto;
        padding: 0;
        border-top: 0;
      }
      .me-avatar {
        width: 2.2rem;
        height: 2.2rem;
      }
      .account {
        left: auto;
        right: 0;
        bottom: auto;
        top: calc(100% + 0.5rem);
      }
    }
    @media print {
      :host {
        background: #fff;
      }
      .frame {
        display: block;
      }
    }
  `,
})
export class ManagerShellComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly session = inject(SessionStore);
  protected readonly store = inject(ManagerStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly busy = signal(false);
  protected readonly menu = signal(false);
  /** The phone sheet with the five destinations. */
  protected readonly mobileNav = signal(false);
  protected readonly demo = DEMO_MODE;

  constructor() {
    const root = inject(DOCUMENT).documentElement;
    root.classList.add('mgr-scale');
    inject(DestroyRef).onDestroy(() => root.classList.remove('mgr-scale'));
    // The sidebar's project tree reads the day overview; a deep link to another page must still fill it.
    if (!this.store.overview()) void this.store.load();
  }

  protected readonly nav: readonly NavItem[] = [
    { id: 'overview', path: '/m/report', label: 'mgr.navOverview', icon: 'home' },
    { id: 'orders', path: '/m', label: 'mgr.navOrders', icon: 'file' },
    { id: 'team', path: '/m', query: { view: 'workers' }, label: 'mgr.navTeam', icon: 'users' },
    { id: 'hours', path: '/m/hours', label: 'mgr.navHours', icon: 'clock' },
    { id: 'projects', path: '/m/projects', label: 'mgr.navProjects', icon: 'folder' },
    { id: 'review', path: '/m', query: { review: 'next' }, label: 'mgr.navReview', icon: 'report' },
  ];
  /** The administrator also manages accounts. */
  protected readonly navItems = computed<readonly NavItem[]>(() =>
    this.store.isAdmin() ? [...this.nav, { id: 'people', path: '/m/people', label: 'mgr.navPeople', icon: 'user-plus' }] : this.nav,
  );
  protected readonly roleLabel = computed(() => `role.${this.session.user()?.role ?? 'MANAGER'}.short` as TranslationKey);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly activeNav = computed(() => {
    const url = this.url();
    if (url.startsWith('/m/projects')) return 'projects';
    if (url.startsWith('/m/people')) return 'people';
    if (url.startsWith('/m/hours')) return 'hours';
    if (url.startsWith('/m/report')) return 'overview';
    if (url.includes('view=workers')) return 'team';
    if (url.includes('review=')) return 'review';
    return 'orders';
  });

  /** The project or object the list is scoped to, read from the URL so the sidebar marks it. */
  protected readonly scope = computed(() => {
    const q = new URLSearchParams(this.url().split('?')[1] ?? '');
    return { project: q.get('project'), site: q.get('site') };
  });

  protected siteIn(sites: readonly { readonly id: string }[]): boolean {
    const site = this.scope().site;
    return !!site && sites.some((s) => s.id === site);
  }

  /** Projects with their objects, from the day's overview or the directory when the day has not loaded. */
  protected readonly projects = computed(() => {
    const d = this.store.overview();
    const projects = d?.projects ?? [];
    const sites = d?.sites ?? this.store.directory()?.sites ?? [];
    const orders = (d?.orders ?? []).map((o) => o.order).filter((o) => o.published);
    return projects
      .map((p) => {
        const mine = orders.filter((o) => o.projectId === p.id);
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          open: mine.filter((o) => o.status !== 'COMPLETED').length,
          issues: mine.filter((o) => o.status === 'ISSUE').length,
          sites: sites.filter((s) => s.projectId === p.id),
        };
      })
      .filter((p) => p.sites.length > 0)
      // Projects with problems first, then the busiest: with many projects the rail leads with what needs a look.
      .sort((a, b) => b.issues - a.issues || b.open - a.open || a.name.localeCompare(b.name));
  });

  protected readonly treeQuery = signal('');
  protected readonly treeAll = signal(false);
  private static readonly TREE_LIMIT = 6;


  private readonly treeMatches = computed(() => {
    const q = this.treeQuery().trim().toLocaleLowerCase();
    return this.projects().filter((p) => !q || `${p.name} ${p.code} ${p.sites.map((s) => s.name).join(' ')}`.toLocaleLowerCase().includes(q));
  });
  protected readonly treeShown = computed(() =>
    this.treeAll() || this.treeQuery().trim() ? this.treeMatches() : this.treeMatches().slice(0, ManagerShellComponent.TREE_LIMIT),
  );
  protected readonly treeHidden = computed(() => this.treeMatches().length - this.treeShown().length);

  protected readonly initials = computed(() =>
    (this.session.user()?.displayName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toLocaleUpperCase() ?? '')
      .join(''),
  );

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
