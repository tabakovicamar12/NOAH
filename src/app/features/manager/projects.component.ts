import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { ApiError, type ManagerProjectsResponse, type ProjectOrderRow, type ProjectSummary } from '../../core/models/api.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ToastService } from '../../core/ui/toast.service';
import type { QuantityUnit, Site } from '../../core/models/domain.models';
import { minutesToHours } from '../../core/util/util';
import { crewLabel } from '../../shared/ui/format';
import { IconComponent } from '../../shared/ui/icon.component';
import { StatusTagComponent } from '../../shared/ui/status-tag.component';
import { progressRatio } from '../../shared/ui/tag-style';
import { ManagerStore } from './data/manager-store.service';

type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly data: ManagerProjectsResponse; readonly cachedAt: number | null };

/** Same rule as the server: short code of letters, digits, `.`, `_`, `-`. */
const CODE_PATTERN = /^[\p{L}\p{N}._-]{1,20}$/u;
const NEW_PROJECT = 'NEW_PROJECT';
const INPUT_CLASS =
  'mt-1 block min-h-12 w-full border-2 border-charcoal bg-stock px-3 font-semibold outline-none placeholder:font-normal placeholder:text-ink-muted focus:ring-4 focus:ring-gold';

interface SiteBlock {
  readonly site: Site;
  readonly orders: readonly ProjectOrderRow[];
}
interface ProjectBlock {
  readonly summary: ProjectSummary;
  readonly sites: readonly SiteBlock[];
  readonly total: number;
  readonly open: number;
  readonly hours: number;
  readonly issues: number;
}

/**
 * Seznam projektov: every project with its objects, and each object's work orders as a ledger.
 * Projects and objects are created by the administrator, or here by a manager allowed to (canManageProjects);
 * managers read here and open orders.
 */
@Component({
  selector: 'aon-manager-projects',
  imports: [RouterLink, NgTemplateOutlet, IconComponent, StatusTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 class="font-cond-tight text-[2.5rem] leading-none sm:text-5xl">{{ i18n.t('projects.title') }}</h1>
          @if (ready(); as r) {
            <p class="mt-2 font-semibold text-ink-muted">{{ i18n.t('projects.subtitle', { n: r.data.projects.length, o: siteCount() }) }}</p>
          }
        </div>
        <div class="flex flex-wrap gap-3">
          @if (canManage()) {
            <button
              type="button"
              class="flex min-h-12 items-center gap-2 border-2 border-charcoal bg-charcoal px-4 font-cond text-lg text-white disabled:opacity-50"
              [disabled]="adding() === NEW_PROJECT"
              (click)="openForm(NEW_PROJECT)"
            >
              <aon-icon name="plus" [size]="18" [stroke]="3" />{{ i18n.t('projects.newProject') }}
            </button>
          }
          <button
            type="button"
            class="flex min-h-12 items-center gap-2 border-2 border-charcoal bg-stock px-4 font-cond text-lg hover:bg-ground-deep disabled:opacity-50"
            [disabled]="state().kind === 'LOADING'"
            (click)="load()"
          >
            <aon-icon name="refresh" [size]="18" [class.animate-spin]="state().kind === 'LOADING'" />{{ i18n.t('mgr.refresh') }}
          </button>
        </div>
      </header>

      @if (adding() === NEW_PROJECT) {
        <form class="mt-5 border-2 border-charcoal bg-stock p-4 sm:p-5" novalidate (submit)="$event.preventDefault(); saveProject()" aria-labelledby="new-project-title">
          <h2 id="new-project-title" class="font-cond text-2xl leading-none">{{ i18n.t('projects.newProjectTitle') }}</h2>
          <div class="mt-4 grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('projects.code') }}</span>
              <input type="text" maxlength="20" autocapitalize="characters" autocomplete="off" [class]="INPUT_CLASS + ' uppercase'" [value]="formCode()" (input)="formCode.set($any($event.target).value)" />
            </label>
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('projects.projectName') }}</span>
              <input type="text" maxlength="120" autocomplete="off" [class]="INPUT_CLASS" [value]="formName()" (input)="formName.set($any($event.target).value)" />
            </label>
          </div>
          <p class="mt-2 text-sm text-ink-muted">{{ i18n.t('projects.codeHint') }}</p>
          <ng-container *ngTemplateOutlet="formFooter" />
        </form>
      }

      <ng-template #formFooter>
        @if (formError(); as err) {
          <p class="mt-3 flex items-start gap-2 border-2 border-hold bg-hold-pale px-3 py-2 font-semibold text-hold-ink" role="alert">
            <aon-icon name="alert" [size]="18" class="mt-0.5 shrink-0" />{{ err }}
          </p>
        }
        <div class="mt-4 flex flex-wrap gap-3">
          <button type="submit" class="flex min-h-12 items-center gap-2 border-2 border-charcoal bg-charcoal px-5 font-cond text-lg text-white disabled:opacity-50" [disabled]="saving()">
            <aon-icon name="plus" [size]="18" [stroke]="3" />{{ saving() ? i18n.t('projects.adding') : i18n.t('projects.add') }}
          </button>
          <button type="button" class="min-h-12 border-2 border-charcoal bg-stock px-5 font-cond text-lg hover:bg-ground-deep" (click)="closeForm()">
            {{ i18n.t('common.cancel') }}
          </button>
        </div>
      </ng-template>

      @if (ready()?.cachedAt; as at) {
        <p class="mt-5 flex items-center gap-2 border-2 border-dashed border-charcoal bg-stock px-4 py-3 font-semibold" role="status">
          <aon-icon name="cloud-off" [size]="20" class="text-hold" />{{ i18n.t('mgr.offlineCached', { time: i18n.date(at) + ' ' + i18n.time(at) }) }}
        </p>
      }

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <label class="relative block w-full sm:w-96">
          <span class="sr-only">{{ i18n.t('projects.search') }}</span>
          <aon-icon name="search" [size]="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            class="block min-h-12 w-full border-2 border-charcoal bg-stock pl-10 pr-3 font-semibold outline-none placeholder:font-normal placeholder:text-ink-muted focus:ring-4 focus:ring-gold"
            [placeholder]="i18n.t('projects.search')"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </label>
        <label class="flex min-h-12 cursor-pointer items-center gap-3">
          <input type="checkbox" class="aon-check" [checked]="showCompleted()" (change)="showCompleted.set($any($event.target).checked)" />
          <span class="font-semibold">{{ i18n.t('projects.showCompleted') }}</span>
        </label>
      </div>

      @switch (state().kind) {
        @case ('LOADING') {
          <div class="mt-6 grid gap-4" aria-busy="true">
            <div class="h-40 animate-pulse bg-ground-deep"></div>
            <div class="h-40 animate-pulse bg-ground-deep"></div>
            <span class="sr-only">{{ i18n.t('common.loading') }}</span>
          </div>
        }
        @case ('ERROR') {
          <div class="mt-6 flex flex-wrap items-center gap-3 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
            <aon-icon name="alert" [size]="20" />{{ i18n.t('projects.loadFailed') }}
            <button type="button" class="min-h-11 bg-charcoal px-4 font-cond text-white" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </div>
        }
        @default {
          @for (p of blocks(); track p.summary.project.id) {
            <section class="mt-8" [attr.aria-labelledby]="'proj-' + p.summary.project.id">
              <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-[3px] border-charcoal pb-2">
                <h2 [id]="'proj-' + p.summary.project.id" class="flex items-baseline gap-3">
                  <span class="bg-charcoal px-2 py-0.5 font-cond-tight text-2xl leading-none text-white">{{ p.summary.project.code }}</span>
                  <span class="font-cond text-3xl leading-none">{{ p.summary.project.name }}</span>
                </h2>
                <p class="flex flex-wrap gap-x-4 gap-y-1 font-cond text-lg">
                  <span>{{ i18n.t('projects.orders', { n: p.total }) }}</span>
                  <span>{{ i18n.t('projects.open', { n: p.open }) }}</span>
                  <span>{{ i18n.t('projects.hours', { h: i18n.number(p.hours) }) }}</span>
                  @if (p.issues) {
                    <span class="flex items-center gap-1 text-hold-ink"><aon-icon name="alert" [size]="16" [stroke]="2.75" />{{ p.issues }}</span>
                  }
                </p>
              </div>

              @if (canManage() && adding() !== p.summary.project.id) {
                <button
                  type="button"
                  class="mt-3 flex min-h-11 items-center gap-1.5 px-3 font-cond text-base ring-2 ring-inset ring-charcoal hover:bg-ground-deep"
                  (click)="openForm(p.summary.project.id)"
                >
                  <aon-icon name="plus" [size]="16" [stroke]="3" />{{ i18n.t('projects.newSite') }}
                </button>
              }

              @if (adding() === p.summary.project.id) {
                <form class="mt-4 border-2 border-charcoal bg-stock p-4 sm:p-5" novalidate (submit)="$event.preventDefault(); saveSite(p.summary.project.id)" [attr.aria-labelledby]="'new-site-' + p.summary.project.id">
                  <h3 [id]="'new-site-' + p.summary.project.id" class="font-cond text-xl leading-none">{{ i18n.t('projects.newSiteTitle', { project: p.summary.project.name }) }}</h3>
                  <div class="mt-4 grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)_minmax(0,14rem)]">
                    <label class="block">
                      <span class="label-caps text-ink-muted">{{ i18n.t('projects.code') }}</span>
                      <input type="text" maxlength="20" autocapitalize="characters" autocomplete="off" [class]="INPUT_CLASS + ' uppercase'" [placeholder]="p.summary.project.code + '-' + (p.summary.sites.length + 1)" [value]="formCode()" (input)="formCode.set($any($event.target).value)" />
                    </label>
                    <label class="block">
                      <span class="label-caps text-ink-muted">{{ i18n.t('projects.siteName') }}</span>
                      <input type="text" maxlength="120" autocomplete="off" [class]="INPUT_CLASS" [value]="formName()" (input)="formName.set($any($event.target).value)" />
                    </label>
                    <label class="block">
                      <span class="label-caps text-ink-muted">{{ i18n.t('projects.city') }}</span>
                      <input type="text" maxlength="80" autocomplete="off" [class]="INPUT_CLASS" [value]="formCity()" (input)="formCity.set($any($event.target).value)" />
                    </label>
                  </div>
                  <p class="mt-2 text-sm text-ink-muted">{{ i18n.t('projects.codeHint') }}</p>
                  <ng-container *ngTemplateOutlet="formFooter" />
                </form>
              }

              @if (!p.sites.length) {
                <p class="mt-4 border-2 border-dashed border-charcoal px-4 py-3 text-ink-muted">{{ i18n.t('projects.noSites') }}</p>
              }

              @for (s of p.sites; track s.site.id) {
                <div class="mt-4">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="flex items-center gap-2 font-cond text-xl">
                      <aon-icon name="pin" [size]="18" />{{ s.site.name }}
                      <span class="font-sans text-sm font-semibold text-ink-muted">{{ s.site.code }}</span>
                    </h3>
                    <a
                      routerLink="/m/orders/new"
                      [queryParams]="{ site: s.site.id }"
                      class="flex min-h-11 items-center gap-1.5 px-3 font-cond text-base text-ink no-underline ring-2 ring-inset ring-charcoal hover:bg-ground-deep"
                    >
                      <aon-icon name="plus" [size]="16" [stroke]="3" />{{ i18n.t('projects.newOrder') }}
                    </a>
                  </div>
                  @if (s.orders.length) {
                    <ul class="mt-2 border-2 border-charcoal bg-stock">
                      @for (o of s.orders; track o.id) {
                        <li class="border-b border-rule-soft last:border-b-0">
                          <a
                            routerLink="/m"
                            [queryParams]="{ order: o.id }"
                            class="grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-2 text-ink no-underline hover:bg-ground sm:grid-cols-[8.5rem_7rem_minmax(0,1fr)_9rem_9rem]"
                            [attr.aria-label]="i18n.t('orders.open', { code: o.code ?? o.title })"
                          >
                            <span>
                              @if (o.published) {
                                <aon-status-tag [status]="o.status" size="sm" />
                              } @else {
                                <span class="inline-flex items-center gap-1.5 border-2 border-dashed border-charcoal px-2 py-1 label-caps leading-none"><aon-icon name="note" [size]="13" [stroke]="3" />{{ i18n.t('mgr.draft') }}</span>
                              }
                            </span>
                            <span class="whitespace-nowrap font-cond-tight text-xl leading-none">{{ o.code ?? i18n.t('form.numberPending') }}</span>
                            <span class="col-span-2 min-w-0 sm:col-span-1">
                              <span class="block truncate font-semibold">{{ o.title }}</span>
                              @if (o.dueDate && o.status !== 'COMPLETED') {
                                <span class="block text-sm text-ink-muted">{{ i18n.t('orders.due', { date: i18n.date(o.dueDate) }) }}</span>
                              }
                            </span>
                            <span class="truncate text-[0.95rem]" [class.text-ink-muted]="!o.crewNames.length" [title]="o.crewNames.join(', ')">{{ crew(o.crewNames) }}</span>
                            <span class="flex items-center gap-2 whitespace-nowrap sm:justify-end">
                              <span class="font-cond text-lg">{{ i18n.number(o.doneQty) }}/{{ i18n.number(o.plannedQty) }} {{ i18n.t(unitKey(o.unit)) }}</span>
                              <span class="h-2.5 w-10 shrink-0 border border-charcoal bg-ground" aria-hidden="true">
                                <span class="block h-full" [class]="o.status === 'COMPLETED' ? 'bg-done' : 'bg-charcoal'" [style.width.%]="progress(o) * 100"></span>
                              </span>
                            </span>
                          </a>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="mt-2 border-2 border-dashed border-charcoal px-4 py-3 text-ink-muted">{{ i18n.t('projects.noOrders') }}</p>
                  }
                </div>
              }
            </section>
          } @empty {
            <div class="mt-8 border-2 border-dashed border-charcoal px-5 py-6">
              <p class="font-cond text-xl">{{ query() ? i18n.t('mgr.noResults') : i18n.t(canManage() ? 'projects.emptyAdmin' : 'projects.empty') }}</p>
            </div>
          }
        }
      }
    </div>
  `,
})
export class ProjectsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(ManagerStore);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(ToastService);

  protected readonly NEW_PROJECT = NEW_PROJECT;
  protected readonly INPUT_CLASS = INPUT_CLASS;
  protected readonly canManage = this.store.canManageProjects;
  /** Which add form is open: NEW_PROJECT, a project id (new object in it), or none. */
  protected readonly adding = signal<string | null>(null);
  protected readonly formCode = signal('');
  protected readonly formName = signal('');
  protected readonly formCity = signal('');
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly query = signal('');
  protected readonly showCompleted = signal(false);

  protected readonly ready = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s : null;
  });
  protected readonly siteCount = computed(() => (this.ready()?.data.projects ?? []).reduce((n, p) => n + p.sites.length, 0));

  protected readonly blocks = computed<readonly ProjectBlock[]>(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const all = this.showCompleted();
    return (this.ready()?.data.projects ?? []).flatMap((summary) => {
      const projectHit = !q || `${summary.project.code} ${summary.project.name}`.toLocaleLowerCase().includes(q);
      const sites = summary.sites
        .map((site) => {
          const siteHit = projectHit || `${site.code} ${site.name} ${site.city}`.toLocaleLowerCase().includes(q);
          const orders = summary.orders
            .filter((o) => o.siteId === site.id && (all || o.status !== 'COMPLETED'))
            .filter((o) => siteHit || `${o.code ?? ''} ${o.title} ${o.crewNames.join(' ')}`.toLocaleLowerCase().includes(q));
          return { site, orders, hit: siteHit || orders.length > 0 };
        })
        .filter((s) => s.hit)
        .map(({ site, orders }) => ({ site, orders }));
      // A project without objects (e.g. just added) still shows, so its first object can be added.
      if (!sites.length && !(projectHit && summary.sites.length === 0)) return [];
      return [
        {
          summary,
          sites,
          total: summary.orders.length,
          open: summary.orders.filter((o) => o.published && o.status !== 'COMPLETED').length,
          hours: minutesToHours(summary.orders.reduce((m, o) => m + o.minutesTotal, 0)),
          issues: summary.orders.filter((o) => o.status === 'ISSUE').length,
        },
      ];
    });
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    if (this.state().kind !== 'READY') this.state.set({ kind: 'LOADING' });
    try {
      const { data, cachedAt } = await this.store.loadProjects();
      this.state.set({ kind: 'READY', data, cachedAt });
    } catch (err: unknown) {
      console.warn('[AON] projects load failed', err);
      this.state.set({ kind: 'ERROR' });
    }
  }

  protected openForm(target: string): void {
    this.adding.set(target);
    this.formCode.set('');
    this.formName.set('');
    this.formCity.set('');
    this.formError.set(null);
  }

  protected closeForm(): void {
    this.adding.set(null);
    this.formError.set(null);
  }

  protected async saveProject(): Promise<void> {
    const input = this.readForm();
    if (!input) return;
    await this.persist(async () => {
      const project = await this.store.createProject(input);
      this.toast.success(this.i18n.t('projects.projectCreated', { code: project.code }));
      this.query.set('');
      // A project is only useful with an object: open that form next.
      this.openForm(project.id);
    });
  }

  protected async saveSite(projectId: string): Promise<void> {
    const input = this.readForm();
    if (!input) return;
    await this.persist(async () => {
      const site = await this.store.createSite({ projectId, ...input, city: this.formCity().trim() });
      this.toast.success(this.i18n.t('projects.siteCreated', { name: site.name }));
      this.closeForm();
    });
  }

  private readForm(): { code: string; name: string } | null {
    const code = this.formCode().trim().toUpperCase();
    const name = this.formName().trim();
    if (!code || !name) {
      this.formError.set(this.i18n.t('projects.errRequired'));
      return null;
    }
    if (!CODE_PATTERN.test(code)) {
      this.formError.set(this.i18n.t('projects.errCode'));
      return null;
    }
    return { code, name };
  }

  private async persist(write: () => Promise<void>): Promise<void> {
    if (this.saving()) return;
    if (!this.network.online()) {
      this.formError.set(this.i18n.t('projects.errOffline'));
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    try {
      await write();
      await this.load();
    } catch (err: unknown) {
      console.warn('[AON] project write failed', err);
      this.formError.set(this.i18n.t(err instanceof ApiError && err.kind === 'CONFLICT' ? 'projects.errCodeTaken' : 'projects.errFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  protected crew(names: readonly string[]): string {
    return crewLabel(names, this.i18n.t('mgr.unassigned'));
  }

  protected progress(o: ProjectOrderRow): number {
    return progressRatio(o.doneQty, o.plannedQty);
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }
}
