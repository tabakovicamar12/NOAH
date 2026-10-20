import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { ApiClient } from '../../core/http/api-client.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { ApiError, type AdminUser, type ManagerProjectsResponse, type ProjectOrderRow, type ProjectSummary } from '../../core/models/api.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ToastService } from '../../core/ui/toast.service';
import type { CrewMember, QuantityUnit, Site, WorkOrderStatus } from '../../core/models/domain.models';
import { HOUSE_CATALOG, HOUSE_CATEGORIES, houseModel, type HouseCategory, type HouseModel } from '../../core/models/house-catalog';
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

/** Portfolio filter driven by the summary cards. */
type Kpi = 'ALL' | 'OPEN' | 'ISSUE' | 'DUE';

interface SiteBlock {
  readonly site: Site;
  readonly orders: readonly ProjectOrderRow[];
  readonly open: number;
  readonly issues: number;
}
interface ProjectBlock {
  readonly summary: ProjectSummary;
  readonly sites: readonly SiteBlock[];
  readonly total: number;
  readonly open: number;
  readonly hours: number;
  readonly issues: number;
  readonly due: number;
}

/** `YYYY-MM-DD` of today plus `days`, local time. */
function isoDay(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Open and due today, within three days, or already late. */
function dueSoon(o: ProjectOrderRow): boolean {
  return !!o.dueDate && o.published && o.status !== 'COMPLETED' && o.dueDate <= isoDay(3);
}

/**
 * Seznam projektov: every project with its objects, and each object's work orders as a ledger.
 * The administrator adds, renames and archives projects and objects here and decides who leads them (managers
 * per project, foremen per object). Managers and foremen see only what they lead and open orders from it.
 */
@Component({
  selector: 'aon-manager-projects',
  imports: [RouterLink, NgTemplateOutlet, IconComponent, StatusTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <ng-container *ngTemplateOutlet="topNew" />
      @if (state().kind === 'READY') {
        <!-- Deadlines on one axis: each open order is a dot on the day it is due. -->
        <section class="pw3" aria-labelledby="pw3-title">
          <div class="pw3-head">
            <h2 id="pw3-title" class="pw-h">{{ i18n.t('projects.dueTitle') }}</h2>
            <ng-container *ngTemplateOutlet="legend" />
          </div>
          <div class="pw3-axis" aria-hidden="true">
            <span class="pw3-late" [style.width.%]="lateWidth"></span>
            @for (t of ticks; track t.day) {
              <span class="pw3-tick" [style.left.%]="t.left">{{ t.label }}</span>
            }
          </div>
          <ul class="pw3-lanes">
            @for (p of blocks(); track p.summary.project.id) {
              <li class="pw3-lane">
                <button type="button" class="pw3-name" [attr.aria-expanded]="isOpen(p.summary.project.id)" (click)="toggle(p.summary.project.id)">
                  <aon-icon name="chevron-right" [size]="14" class="pv-chev" />
                  <span class="truncate">{{ p.summary.project.name }}</span>
                  @if (p.issues) {
                    <span class="pw3-issue">{{ p.issues }}</span>
                  }
                </button>
                <div class="pw3-track">
                  <span class="pw3-late" [style.width.%]="lateWidth"></span>
                  <span class="pw3-today" [style.left.%]="todayLeft"></span>
                  @for (o of dueOrders(p); track o.id) {
                    <a
                      class="pw-dot pw3-dot"
                      [attr.data-s]="o.status"
                      [class.is-dim]="dimmed(o.status)"
                      [style.left.%]="dueLeft(o)"
                      [routerLink]="['/m/orders', o.id]"
                      [attr.aria-label]="(o.code ?? '') + ' ' + o.title + ' · ' + i18n.t('orders.due', { date: i18n.date(o.dueDate ?? '') })"
                      [title]="(o.code ?? '') + ' · ' + o.title + ' · ' + i18n.date(o.dueDate ?? '')"
                    ></a>
                  }
                </div>
                <span class="pw3-count">{{ p.open }}</span>
              </li>
              @if (isOpen(p.summary.project.id)) {
                <li class="pw3-open">
                  <ng-container *ngTemplateOutlet="projectDetail; context: { $implicit: p }" />
                </li>
              }
            } @empty {
              <li class="pw-empty">
                {{ query() || kpi() !== 'ALL' ? i18n.t('mgr.noResults') : i18n.t(canManage() ? 'projects.emptyAdmin' : 'projects.emptyScope') }}
              </li>
            }
          </ul>
          <p class="pw-note">{{ i18n.t('projects.dueNote') }}</p>
        </section>
      } @else {
        <ng-container *ngTemplateOutlet="stateBox" />
      }
    </div>

    <!-- New page head shared by the variants: title, actions, search in the site-office style. -->
    <ng-template #topNew>
      <header class="pt-head">
        <div>
          <h1 class="pt-title">{{ i18n.t('projects.title') }}</h1>
          @if (ready(); as r) {
            <p class="pt-sub">{{ i18n.t('projects.subtitle', { n: r.data.projects.length, o: siteCount() }) }}</p>
          }
        </div>
        <div class="pt-actions">
          <button type="button" class="pt-quiet" [disabled]="state().kind === 'LOADING'" (click)="load()" [attr.aria-label]="i18n.t('mgr.refresh')">
            <aon-icon name="refresh" [size]="16" [class.animate-spin]="state().kind === 'LOADING'" />
          </button>
          @if (canManage()) {
            <button type="button" class="pt-gold" [disabled]="adding() === NEW_PROJECT" (click)="openForm(NEW_PROJECT)">
              <aon-icon name="plus" [size]="16" [stroke]="2.25" />{{ i18n.t('projects.newProject') }}
            </button>
          }
        </div>
      </header>
      <ng-container *ngTemplateOutlet="newProjectForm" />
      @if (ready()?.cachedAt; as at) {
        <p class="pt-cached" role="status"><aon-icon name="cloud-off" [size]="16" />{{ i18n.t('mgr.offlineCached', { time: i18n.date(at) + ' ' + i18n.time(at) }) }}</p>
      }
      <div class="pt-tools">
        <label class="pt-search">
          <span class="sr-only">{{ i18n.t('projects.search') }}</span>
          <aon-icon name="search" [size]="16" />
          <input type="search" [placeholder]="i18n.t('projects.search')" [value]="query()" (input)="query.set($any($event.target).value)" />
        </label>
        <label class="pt-check">
          <input type="checkbox" class="aon-check" [checked]="showCompleted()" (change)="showCompleted.set($any($event.target).checked)" />
          <span>{{ i18n.t('projects.showCompleted') }}</span>
        </label>
      </div>
      @if (ready()) {
        <ng-container *ngTemplateOutlet="kpiStrip" />
      }
    </ng-template>

    <ng-template #legend>
      <div class="flt" role="group" [attr.aria-label]="i18n.t('projects.legend')">
        <button type="button" class="flt-btn" [attr.aria-pressed]="statusFilter() === null" (click)="statusFilter.set(null)">{{ i18n.t('mgr.tabAll') }}</button>
        @for (st of legendStatuses; track st) {
          <button type="button" class="flt-btn" [attr.aria-pressed]="statusFilter() === st" (click)="toggleStatus(st)">
            <span class="pw-dot is-static" [attr.data-s]="st"></span>{{ i18n.t(statusKey(st)) }}<span class="flt-n">{{ statusCounts()[st] }}</span>
          </button>
        }
      </div>
    </ng-template>

    <ng-template #projectDetail let-p>
      <div class="pw-detail">
        <div class="pw-detail-head">
          <p class="pv-lead">
            <span>{{ i18n.t('projects.managers') }}</span>
            <b [class.pv-none]="!p.summary.managers.length">{{ names(p.summary.managers) || i18n.t('projects.nobody') }}</b>
          </p>
          <div class="pv-head-actions">
            @if (canManage() && editing()?.id !== p.summary.project.id) {
              <button type="button" class="pv-quiet" (click)="openEdit('PROJECT', p.summary.project.id, p.summary.project.name, '', p.summary.managers)">
                <aon-icon name="pencil" [size]="15" />{{ i18n.t('projects.editProject') }}
              </button>
            }
            <a class="pv-link" routerLink="/m" [queryParams]="{ project: p.summary.project.id }">{{ i18n.t('projects.allOrders', { n: p.total }) }}<aon-icon name="arrow-right" [size]="16" /></a>
          </div>
        </div>
        @if (editing()?.id === p.summary.project.id) {
          <ng-container *ngTemplateOutlet="editPanel" />
        }
        @if (!p.sites.length) {
          <p class="pv-muted">{{ i18n.t('projects.noSites') }}</p>
        }
        @for (s of p.sites; track s.site.id) {
          <div class="pv-site-block">
            <div class="pv-site-head">
              <h3>
                {{ s.site.name }}<span class="pv-code">{{ s.site.code }}</span>
                @if (houseOf(s.site); as m) {
                  <span class="pv-house">{{ i18n.t(chipKey(m.category)) }} · {{ i18n.number(m.area) }} m²@if (m.extraArea) { + {{ i18n.number(m.extraArea) }} m² {{ i18n.t('projects.balcony') }}}@if (m.twoFlats) { · {{ i18n.t('projects.twoFlats') }}}</span>
                }
              </h3>
              <div class="pv-head-actions">
                <span class="pv-foreman">
                  {{ i18n.t('projects.foremen') }}
                  <b [class.pv-none]="!foremenOf(p, s.site.id).length">{{ names(foremenOf(p, s.site.id)) || i18n.t('projects.nobody') }}</b>
                </span>
                @if (canManage() && editing()?.id !== s.site.id) {
                  <button type="button" class="pv-quiet" (click)="openEdit('SITE', s.site.id, s.site.name, s.site.city, foremenOf(p, s.site.id), s.site.houseModel ?? null)">
                    <aon-icon name="pencil" [size]="15" />{{ i18n.t('projects.editSite') }}
                  </button>
                }
                <a class="pv-quiet" routerLink="/m/orders/new" [queryParams]="{ site: s.site.id }"><aon-icon name="plus" [size]="15" [stroke]="2.25" />{{ i18n.t('projects.newOrder') }}</a>
              </div>
            </div>
            @if (editing()?.id === s.site.id) {
              <ng-container *ngTemplateOutlet="editPanel" />
            }
            @if (s.orders.length) {
              <ul class="pv-orders">
                @for (o of s.orders; track o.id) {
                  <li><ng-container *ngTemplateOutlet="orderRow; context: { $implicit: o }" /></li>
                }
              </ul>
            } @else {
              <p class="pv-muted">{{ i18n.t('projects.noOrders') }}</p>
            }
          </div>
        }
        <ng-container *ngTemplateOutlet="siteAdd; context: { $implicit: p }" />
      </div>
    </ng-template>

    <ng-template #stateBox>
      @if (state().kind === 'LOADING') {
        <div class="mt-6 grid gap-4" aria-busy="true">
          <div class="h-40 animate-pulse rounded-xl bg-[var(--color-track)]"></div>
          <div class="h-40 animate-pulse rounded-xl bg-[var(--color-track)]"></div>
          <span class="sr-only">{{ i18n.t('common.loading') }}</span>
        </div>
      } @else {
        <div class="pt-error" role="alert">
          <aon-icon name="alert" [size]="18" />{{ i18n.t('projects.loadFailed') }}
          <button type="button" class="pt-quiet" (click)="load()">{{ i18n.t('common.retry') }}</button>
        </div>
      }
    </ng-template>



    <ng-template #newProjectForm>
      @if (adding() === NEW_PROJECT) {
        <form class="as-panel as-top" novalidate (submit)="$event.preventDefault(); saveProject()" aria-labelledby="new-project-title">
          <h2 id="new-project-title" class="as-title">{{ i18n.t('projects.newProjectTitle') }}</h2>
          <div class="as-grid">
            <label class="as-field">
              <span>{{ i18n.t('projects.projectName') }}</span>
              <input type="text" maxlength="120" autocomplete="off" [value]="formName()" (input)="formName.set($any($event.target).value)" />
            </label>
          </div>
          <p class="as-hint">{{ i18n.t('projects.autoNumber') }}</p>
          <ng-container *ngTemplateOutlet="formFooter" />
        </form>
      }

    </ng-template>

      <ng-template #formFooter>
        @if (formError(); as err) {
          <p class="as-error" role="alert"><aon-icon name="alert" [size]="17" />{{ err }}</p>
        }
        <div class="as-foot">
          <button type="submit" class="as-save" [disabled]="saving()">
            <aon-icon name="plus" [size]="16" [stroke]="2.25" />{{ saving() ? i18n.t('projects.adding') : i18n.t('projects.add') }}
          </button>
          <button type="button" class="pt-quiet" (click)="closeForm()">{{ i18n.t('common.cancel') }}</button>
        </div>
      </ng-template>

      <!-- Administrator: rename, choose who leads it, archive. One panel for a project or an object. -->
      <ng-template #editPanel>
        @if (editing(); as e) {
          <form class="as-panel" novalidate (submit)="$event.preventDefault(); saveEdit()" [attr.aria-label]="i18n.t(e.kind === 'PROJECT' ? 'projects.editProject' : 'projects.editSite')">
            @if (e.kind === 'SITE') {
              <ng-container *ngTemplateOutlet="housePick; context: { $implicit: editModel(), pick: pickEditModel }" />
            }
            <div class="as-grid" [class.as-grid-2]="e.kind === 'SITE'">
              <label class="as-field">
                <span>{{ i18n.t(e.kind === 'PROJECT' ? 'projects.projectName' : 'projects.siteName') }}</span>
                <input type="text" maxlength="120" autocomplete="off" [value]="editName()" (input)="editName.set($any($event.target).value)" />
              </label>
              @if (e.kind === 'SITE') {
                <label class="as-field">
                  <span>{{ i18n.t('projects.city') }}</span>
                  <input type="text" maxlength="80" autocomplete="off" [value]="editCity()" (input)="editCity.set($any($event.target).value)" />
                </label>
              }
            </div>
            <fieldset class="as-people">
              <legend>{{ i18n.t(e.kind === 'PROJECT' ? 'projects.pickManagers' : 'projects.pickForemen') }}</legend>
              @if (candidates(); as list) {
                @for (u of list; track u.id) {
                  <label class="as-person">
                    <input type="checkbox" class="aon-check" [checked]="picked().has(u.id)" (change)="togglePick(u.id)" />
                    <span class="as-person-name">{{ u.displayName }}</span>
                    <span class="as-muted">{{ u.username }}</span>
                  </label>
                } @empty {
                  <p class="as-muted">{{ i18n.t(e.kind === 'PROJECT' ? 'projects.noManagerAccounts' : 'projects.noForemanAccounts') }}</p>
                }
              } @else {
                <p class="as-muted">{{ i18n.t('common.loading') }}</p>
              }
            </fieldset>
            @if (formError(); as err) {
              <p class="as-error" role="alert"><aon-icon name="alert" [size]="17" />{{ err }}</p>
            }
            <div class="as-foot">
              <button type="submit" class="as-save" [disabled]="saving()">{{ saving() ? i18n.t('projects.saving') : i18n.t('common.save') }}</button>
              <button type="button" class="pt-quiet" (click)="closeEdit()">{{ i18n.t('common.cancel') }}</button>
              <span class="as-spacer"></span>
              <button type="button" class="as-archive" [disabled]="saving()" (click)="archive()">
                <aon-icon name="archive" [size]="15" />{{ i18n.t(confirmArchive() ? 'projects.archiveConfirm' : e.kind === 'PROJECT' ? 'projects.archiveProject' : 'projects.archiveSite') }}
              </button>
            </div>
            @if (confirmArchive()) {
              <p class="as-hint">{{ i18n.t('projects.archiveHint') }}</p>
            }
          </form>
        }
      </ng-template>

      <!-- Portfolio cards: each figure filters the list; pressing it again shows everything. -->
      <ng-template #kpiStrip>
        @let f = portfolio();
        <div class="kc3">
          <div class="kc3-tabs" role="tablist" [attr.aria-label]="i18n.t('projects.title')">
            @for (t of kcTabs(); track t.key) {
              <button
                type="button"
                role="tab"
                class="kc3-tab"
                [class.is-bad]="t.key === 'ISSUE'"
                [class.is-due]="t.key === 'DUE'"
                [attr.aria-selected]="kpi() === t.key"
                [disabled]="!t.value && t.key !== 'ALL'"
                (click)="t.key === 'ALL' ? kpi.set('ALL') : setKpi(t.key)"
              >
                <span class="kc-label"><aon-icon [name]="t.icon" [size]="15" />{{ i18n.t(t.label) }}</span>
                <span class="kc3-value">{{ t.value }}</span>
              </button>
            }
            <div class="kc3-tab is-static">
              <span class="kc-label"><aon-icon name="clock" [size]="15" />{{ i18n.t('projects.kpiHours') }}</span>
              <span class="kc3-value">{{ i18n.number(f.hours) }}<small> h</small></span>
            </div>
          </div>
          <!-- The chosen figure opens its orders right here: the card is the way in, not just a number. -->
          @if (kpi() !== 'ALL') {
            <div class="kc3-panel" role="tabpanel">
              <div class="kc3-panel-head">
                <p>{{ i18n.t('projects.filtered', { name: kpiLabel(kpi()) }) }}</p>
                <button type="button" class="kc-clear" (click)="kpi.set('ALL')"><aon-icon name="x" [size]="14" />{{ i18n.t('projects.clearFilter') }}</button>
              </div>
              <ul class="kc3-list">
                @for (o of kpiOrders(); track o.id) {
                  <li>
                    <a [routerLink]="['/m/orders', o.id]">
                      <span class="pw-dot is-static" [attr.data-s]="o.status"></span>
                      <span class="kc3-code">{{ o.code }}</span>
                      <span class="truncate">{{ o.title }}</span>
                      <span class="kc-muted truncate">{{ o.projectName }}</span>
                      @if (o.dueDate) {
                        <span class="kc3-due" [class.is-late]="isLate(o)">{{ i18n.dateShort(o.dueDate) }}</span>
                      }
                      <aon-icon name="chevron-right" [size]="16" class="kc-muted" />
                    </a>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      </ng-template>

      <ng-template #orderRow let-o>
        <a class="pv-order" [routerLink]="['/m/orders', o.id]" [attr.aria-label]="i18n.t('orders.open', { code: o.code ?? o.title })">
          <span class="pv-order-code">{{ o.code ?? i18n.t('form.numberPending') }}</span>
          <span class="pv-order-title">
            <span class="block truncate">{{ o.title }}</span>
            @if (o.dueDate && o.status !== 'COMPLETED') {
              <span class="pv-order-due" [class.is-due]="isDueSoon(o)">{{ i18n.t('orders.due', { date: i18n.date(o.dueDate) }) }}</span>
            }
          </span>
          <span class="pv-order-crew" [class.pv-muted]="!o.crewNames.length" [title]="o.crewNames.join(', ')">{{ crew(o.crewNames) }}</span>
          <span class="pv-order-qty">{{ i18n.number(o.doneQty) }}/{{ i18n.number(o.plannedQty) }} {{ i18n.t(unitKey(o.unit)) }}</span>
          <span class="pv-order-status">
            @if (o.published) {
              <aon-status-tag [status]="o.status" size="sm" />
            } @else {
              <span class="pv-draft">{{ i18n.t('mgr.draft') }}</span>
            }
          </span>
        </a>
      </ng-template>

      <!-- Catalogue house or a hand-typed name. Choosing a house fills in the name, which stays editable. -->
      <ng-template #housePick let-value let-pick="pick">
        <label class="as-field as-house">
          <span>{{ i18n.t('projects.houseModel') }}</span>
          <select [value]="value" (change)="pick($any($event.target).value)">
            <option value="">{{ i18n.t('projects.houseManual') }}</option>
            @for (cat of houseCategories; track cat) {
              <optgroup [label]="i18n.t(catKey(cat))">
                @for (m of modelsOf(cat); track m.id) {
                  <option [value]="m.id" [selected]="m.id === value">{{ m.name }} · {{ i18n.number(m.area) }} m²</option>
                }
              </optgroup>
            }
          </select>
        </label>
        <p class="as-hint">{{ i18n.t(value ? 'projects.houseHintModel' : 'projects.houseHintManual') }}</p>
      </ng-template>

      <ng-template #siteAdd let-p>
        @if (canManage() && adding() !== p.summary.project.id) {
          <button type="button" class="pv-quiet pv-add" (click)="openForm(p.summary.project.id)">
            <aon-icon name="plus" [size]="15" [stroke]="2.25" />{{ i18n.t('projects.newSite') }}
          </button>
        }
        @if (adding() === p.summary.project.id) {
          <form class="as-panel" novalidate (submit)="$event.preventDefault(); saveSite(p.summary.project.id)" [attr.aria-labelledby]="'new-site-' + p.summary.project.id">
            <h3 [id]="'new-site-' + p.summary.project.id" class="as-title">{{ i18n.t('projects.newSiteTitle', { project: p.summary.project.name }) }}</h3>
            <ng-container *ngTemplateOutlet="housePick; context: { $implicit: formModel(), pick: pickNewModel }" />
            <div class="as-grid as-grid-3">
              <label class="as-field">
                <span>{{ i18n.t('projects.codeOptional') }}</span>
                <input type="text" maxlength="20" autocapitalize="characters" autocomplete="off" class="uppercase" [placeholder]="'O-' + (p.summary.sites.length + 1)" [value]="formCode()" (input)="formCode.set($any($event.target).value)" />
              </label>
              <label class="as-field">
                <span>{{ i18n.t('projects.siteName') }}</span>
                <input type="text" maxlength="120" autocomplete="off" [value]="formName()" (input)="formName.set($any($event.target).value)" />
              </label>
              <label class="as-field">
                <span>{{ i18n.t('projects.city') }}</span>
                <input type="text" maxlength="80" autocomplete="off" [value]="formCity()" (input)="formCity.set($any($event.target).value)" />
              </label>
            </div>
            <p class="as-hint">{{ i18n.t('projects.siteAutoNumber') }}</p>
            <ng-container *ngTemplateOutlet="formFooter" />
          </form>
        }
      </ng-template>

  `,
  styles: `
    .as-house + .as-hint {
      margin-bottom: 0.85rem;
    }
    .pv-house {
      display: inline-block;
      margin-left: 0.5rem;
      padding: 0.1rem 0.55rem;
      border-radius: 9999px;
      background: var(--color-gold-tint);
      color: var(--color-text);
      font-size: 0.78rem;
      font-weight: 500;
      vertical-align: middle;
      white-space: nowrap;
    }
    /* ---- Who leads it ---- */
    .pw-detail-head,
    .pv-head-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
    }
    .pw-detail-head {
      justify-content: space-between;
    }
    .pv-lead,
    .pv-foreman {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.93rem;
    }
    .pv-lead b,
    .pv-foreman b {
      color: var(--color-text);
      font-weight: 600;
    }
    .pv-lead b.pv-none,
    .pv-foreman b.pv-none {
      color: var(--color-text-muted);
      font-weight: 400;
      font-style: italic;
    }

    /* ---- Administrator panels: new project, new object, edit ---- */
    .as-panel {
      container-type: inline-size;
      margin: 0.75rem 0 0.25rem;
      padding: 1rem 1.1rem 1.05rem;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 10px 26px -20px rgb(20 20 20 / 0.3);
    }
    .as-top {
      margin-top: 1rem;
    }
    .as-title {
      margin-bottom: 0.8rem;
      font-size: 1.1rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .as-grid {
      display: grid;
      gap: 0.75rem;
    }
    /* Columns follow the panel's own width, not the window's: the panel often sits in a narrow detail pane. */
    @container (min-width: 28rem) {
      .as-grid-2 {
        grid-template-columns: 11rem minmax(0, 1fr);
      }
      .as-grid-3 {
        grid-template-columns: 8rem minmax(0, 1fr);
      }
      .as-grid-3 > :nth-child(3) {
        grid-column: 1 / -1;
      }
    }
    @container (min-width: 44rem) {
      .as-grid-3 {
        grid-template-columns: 9rem minmax(0, 1fr) minmax(0, 13rem);
      }
      .as-grid-3 > :nth-child(3) {
        grid-column: auto;
      }
    }
    .as-field {
      display: grid;
      gap: 0.3rem;
      min-width: 0;
    }
    .as-field > span {
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .as-field input,
    .as-field select {
      width: 100%;
      min-width: 0;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 500;
      outline: none;
      transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
    }
    .as-field select {
      appearance: none;
      padding-right: 2.5rem;
      background: #fff url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236b6a65%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E") no-repeat right 0.75rem center / 1.1rem;
    }
    .as-field input:focus,
    .as-field select:focus {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25);
    }
    .as-hint {
      margin-top: 0.45rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .as-people {
      margin-top: 0.9rem;
    }
    .as-people legend {
      margin-bottom: 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .as-person {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      min-height: 2.75rem;
      padding: 0 0.6rem;
      border-radius: 0.5rem;
      cursor: pointer;
    }
    .as-person:hover {
      background: var(--color-row-tint);
    }
    .as-person-name {
      font-weight: 500;
    }
    .as-muted {
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .as-error {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin-top: 0.8rem;
      padding: 0.6rem 0.75rem;
      border-radius: 0.5rem;
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
      font-weight: 500;
    }
    .as-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .as-spacer {
      flex: 1 1 auto;
    }
    .as-save {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.6rem;
      padding: 0 1.05rem;
      border-radius: 0.5rem;
      background: var(--color-rail);
      color: #fff;
      font-weight: 600;
    }
    .as-save:hover:not(:disabled) {
      background: var(--color-charcoal);
    }
    .as-save:disabled,
    .as-archive:disabled {
      opacity: 0.55;
    }
    .as-archive {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.6rem;
      padding: 0 0.8rem;
      border-radius: 0.5rem;
      color: var(--color-bad-ink);
      font-weight: 500;
    }
    .as-archive:hover:not(:disabled) {
      background: var(--color-bad-tint);
    }

    /* ---- Summary cards (variants) ---- */
    .kc-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--color-text-muted);
      font-size: 0.93rem;
    }
    .kc-value {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      font-size: 2.09rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.05;
      font-variant-numeric: tabular-nums;
    }
    .kc-value small {
      color: var(--color-text-muted);
      font-size: 0.875rem;
      font-weight: 400;
      letter-spacing: 0;
    }
    .kc-muted {
      color: var(--color-text-muted);
    }
    .kc-clear {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      min-height: 2.25rem;
      padding: 0 0.7rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.45rem;
      background: var(--color-panel);
      font-size: 0.9rem;
      font-weight: 500;
    }
    .is-late {
      color: var(--color-bad);
    }

    /* V3: figures as tabs that open their orders */
    .kc3 {
      margin: 0.5rem 0 1.25rem;
      overflow: hidden;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 8px 24px -18px rgb(20 20 20 / 0.25);
    }
    .kc3-tabs {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .kc3-tab {
      position: relative;
      display: grid;
      gap: 0.2rem;
      padding: 0.9rem 1.1rem 1rem;
      color: var(--color-text);
      text-align: left;
      transition: background-color 160ms var(--ease-out-expo);
    }
    .kc3-tab + .kc3-tab {
      border-left: 1px solid var(--color-line);
    }
    button.kc3-tab:hover:not(:disabled) {
      background: var(--color-row-tint);
    }
    .kc3-tab[aria-selected='true'] {
      background: var(--color-gold-fill);
    }
    .kc3-tab[aria-selected='true']::after {
      content: '';
      position: absolute;
      inset: auto 0 0;
      height: 3px;
      background: var(--color-gold);
    }
    .kc3-tab:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .kc3-value {
      font-size: 1.85rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .kc3-value small {
      color: var(--color-text-muted);
      font-size: 0.95rem;
      font-weight: 500;
    }
    .kc3-tab.is-bad:not(:disabled) .kc3-value,
    .kc3-tab.is-bad:not(:disabled) .kc-label {
      color: var(--color-bad);
    }
    .kc3-tab.is-due:not(:disabled) .kc3-value {
      color: var(--color-gold-ink);
    }
    .kc3-panel {
      border-top: 1px solid var(--color-line);
      background: var(--color-row-tint);
    }
    .kc3-panel-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.7rem 1.1rem;
      color: var(--color-text-muted);
      font-size: 0.93rem;
    }
    .kc3-list > li + li {
      border-top: 1px solid var(--color-line);
    }
    .kc3-list a {
      display: grid;
      grid-template-columns: auto 6.5rem minmax(0, 2fr) minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 0.75rem;
      min-height: 2.9rem;
      padding: 0 1.1rem;
      background: var(--color-panel);
      color: var(--color-text);
      text-decoration: none;
    }
    .kc3-list a:hover {
      background: var(--color-gold-fill);
    }
    .kc3-code {
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    .kc3-due {
      font-size: 0.9rem;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 1100px) {
      .kc3-tabs {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .kc3-tab:nth-child(4) {
        border-left: 0;
      }
      .kc3-tab:nth-child(n + 4) {
        border-top: 1px solid var(--color-line);
      }
      /* Five tiles in rows of three: the last one takes the rest of its row, no empty gap. */
      .kc3-tab:last-child {
        grid-column: span 2;
      }
    }
    @media (max-width: 700px) {
      .kc3-tabs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .kc3-tab:nth-child(odd) {
        border-left: 0;
      }
      .kc3-tab:nth-child(4) {
        border-left: 1px solid var(--color-line);
      }
      .kc3-tab:nth-child(n + 3) {
        border-top: 1px solid var(--color-line);
      }
      .kc3-tab:last-child {
        grid-column: 1 / -1;
      }
      .kc3-list a {
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        gap: 0.6rem;
        padding: 0 0.9rem;
      }
      .kc3-code,
      .kc3-list a > .kc-muted.truncate {
        display: none;
      }
    }
    /* ---- Page head (new) ---- */
    .pt-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem 1.5rem;
    }
    .pt-title {
      font-size: clamp(1.6rem, 1.3rem + 1.2vw, 2.09rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .pt-sub {
      margin-top: 0.3rem;
      color: var(--color-text-muted);
    }
    .pt-actions {
      display: flex;
      gap: 0.5rem;
    }
    .pt-quiet {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      min-width: 2.6rem;
      min-height: 2.6rem;
      padding: 0 0.7rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 500;
    }
    .pt-quiet:hover {
      background: var(--color-field);
    }
    .pt-gold {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.6rem;
      padding: 0 1rem;
      border-radius: 0.5rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 600;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12), inset 0 -2px 0 rgb(0 0 0 / 0.08);
    }
    .pt-gold:hover:not(:disabled) {
      filter: brightness(1.04);
    }
    .pt-cached {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 1rem;
      padding: 0.6rem 0.8rem;
      border-radius: 0.5rem;
      background: var(--color-gold-fill);
      color: var(--color-gold-ink);
      font-size: 0.93rem;
    }
    .pt-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1.25rem;
      margin: 1.25rem 0 1rem;
    }
    .pt-search {
      display: flex;
      flex: 1 1 18rem;
      max-width: 28rem;
      align-items: center;
      gap: 0.5rem;
      height: 2.6rem;
      padding: 0 0.8rem;
      border: 1px solid var(--color-line);
      border-radius: 0.5rem;
      background: var(--color-panel);
      color: var(--color-text-muted);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04);
    }
    .pt-search:focus-within {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.18);
    }
    .pt-search input {
      width: 100%;
      min-width: 0;
      border: 0;
      background: transparent;
      color: var(--color-text);
      font-size: 1rem;
      outline: none;
    }
    .pt-check {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-height: 2.6rem;
      cursor: pointer;
    }
    .pt-error {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem;
      margin-top: 1.25rem;
      padding: 0.75rem 0.9rem;
      border: 1px solid #ef9a9a;
      border-radius: 0.6rem;
      background: #fdeced;
      color: var(--color-bad-ink);
    }

    /* ---- Shared dot language ---- */
    .pw-h {
      font-size: 1.1rem;
      font-weight: 600;
    }
    .pw-code {
      color: var(--color-text-muted);
      font-size: 0.8rem;
      font-weight: 500;
    }
    .pw-empty {
      padding: 1rem;
      color: var(--color-text-muted);
    }
    .pw-note {
      margin-top: 0.75rem;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .pw-dot {
      display: block;
      flex: 0 0 auto;
      width: 0.95rem;
      height: 0.95rem;
      border-radius: 9999px;
      background: #c5c9d2;
      transition: transform 140ms var(--ease-out-expo), opacity 160ms var(--ease-out-expo), box-shadow 140ms var(--ease-out-expo);
    }
    .pw-dot[data-s='COMPLETED'] {
      background: var(--color-progress);
    }
    .pw-dot[data-s='IN_PROGRESS'] {
      background: var(--color-blue);
    }
    .pw-dot[data-s='ISSUE'] {
      background: var(--color-bad);
    }
    a.pw-dot:hover,
    a.pw-dot:focus-visible {
      transform: scale(1.35);
      box-shadow: 0 0 0 3px rgb(255 255 255), 0 0 0 4px var(--color-charcoal);
      outline: none;
    }
    .pw-dot.is-dim {
      opacity: 0.18;
    }
    .pw-dot.is-static {
      width: 0.7rem;
      height: 0.7rem;
    }
    .pw-detail {
      padding: 1rem 1.1rem 1.1rem;
    }
    .pw-detail-head {
      margin-bottom: 0.9rem;
    }

    /* V3: deadline lanes */
    .pw3 {
      padding: 1rem 1.2rem 1.1rem;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 8px 24px -18px rgb(20 20 20 / 0.25);
    }
    .pw3-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .pw3-axis {
      position: relative;
      height: 1.4rem;
      margin-left: 14rem;
      margin-right: 2.5rem;
      color: var(--color-text-muted);
      font-size: 0.8rem;
    }
    .pw3-axis .pw3-late {
      height: 100%;
      border-radius: 0.3rem 0 0 0.3rem;
    }
    .pw3-tick {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .pw3-lane {
      display: grid;
      grid-template-columns: 13rem minmax(0, 1fr) 1.5rem;
      align-items: center;
      gap: 1rem;
      min-height: 3rem;
      border-top: 1px solid var(--color-line);
    }
    .pw3-name {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 0.35rem;
      color: var(--color-text);
      font-weight: 600;
      text-align: left;
    }
    [aria-expanded='true'] > .pv-chev {
      transform: rotate(90deg);
    }
    .pw3-issue {
      display: inline-grid;
      flex: 0 0 auto;
      place-items: center;
      min-width: 1.3rem;
      height: 1.3rem;
      border-radius: 9999px;
      background: var(--color-bad-tint);
      color: var(--color-bad);
      font-size: 0.75rem;
    }
    .pw3-track {
      position: relative;
      height: 2.2rem;
      border-radius: 0.4rem;
      background: repeating-linear-gradient(to right, transparent 0, transparent calc(100% / 17 - 1px), var(--color-line) calc(100% / 17 - 1px), var(--color-line) calc(100% / 17));
    }
    .pw3-late {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      background: rgb(200 21 29 / 0.06);
    }
    .pw3-today {
      position: absolute;
      top: -0.2rem;
      bottom: -0.2rem;
      width: 2px;
      background: var(--color-gold);
    }
    .pw3-dot {
      position: absolute;
      top: 50%;
      margin: -0.48rem 0 0 -0.48rem;
    }
    .pw3-count {
      color: var(--color-text-muted);
      font-size: 0.9rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .pw3-open {
      border-top: 1px solid var(--color-line);
    }

    @media (max-width: 820px) {
      .pw3-axis {
        margin-left: 0;
        margin-right: 0;
      }
      .pw3-lane {
        grid-template-columns: minmax(0, 1fr) 1.5rem;
        row-gap: 0.25rem;
        padding: 0.5rem 0;
      }
      .pw3-track {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
    /* ---- Shared: portfolio cards, dot mix, order rows ---- */
    .pv-code {
      color: var(--color-text-muted);
      font-size: 0.875rem;
      font-weight: 500;
    }
    .pv-muted {
      color: var(--color-text-muted);
    }
    .pv-chev {
      color: var(--color-text-muted);
      transition: transform 200ms var(--ease-out-expo);
    }
    [aria-expanded='true'] .pv-chev {
      transform: rotate(90deg);
    }
    .pv-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-height: 2.5rem;
      padding: 0 0.8rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 500;
      white-space: nowrap;
      text-decoration: none;
    }
    .pv-link:hover {
      background: var(--color-field);
    }
    .pv-quiet {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-height: 2.25rem;
      padding: 0 0.6rem;
      border-radius: 0.45rem;
      color: var(--color-text-muted);
      font-size: 0.95rem;
      font-weight: 500;
      text-decoration: none;
    }
    .pv-quiet:hover {
      background: var(--color-field);
      color: var(--color-text);
    }
    .pv-add {
      margin-top: 0.5rem;
    }
    .pv-site-block + .pv-site-block {
      margin-top: 1.1rem;
    }
    .pv-site-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .pv-site-head h3 {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .pv-orders {
      margin-top: 0.4rem;
      overflow: hidden;
      border: 1px solid var(--color-line);
      border-radius: 0.5rem;
    }
    .pv-orders > li + li {
      border-top: 1px solid var(--color-line);
    }
    .pv-order {
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr) 9rem 8rem 7.5rem;
      align-items: center;
      gap: 0.75rem;
      min-height: 3.1rem;
      padding: 0.35rem 0.85rem;
      color: var(--color-text);
      text-decoration: none;
    }
    .pv-order:hover {
      background: var(--color-row-tint);
    }
    .pv-order-code {
      font-weight: 500;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }
    .pv-order-title {
      min-width: 0;
    }
    .pv-order-due {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .pv-order-due.is-due {
      color: var(--color-gold-ink);
      font-weight: 600;
    }
    .pv-order-crew {
      overflow: hidden;
      font-size: 0.95rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pv-order-qty {
      font-size: 0.95rem;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .pv-order-status {
      justify-self: end;
    }
    .pv-draft {
      display: inline-flex;
      align-items: center;
      height: 1.75rem;
      padding: 0 0.6rem;
      border-radius: 9999px;
      box-shadow: inset 0 0 0 1px var(--color-line-strong);
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }

    @media (max-width: 1100px) {
      .pv-order {
        grid-template-columns: 7rem minmax(0, 1fr) 7.5rem;
      }
      .pv-order-crew,
      .pv-order-qty {
        display: none;
      }
    }
    @media (max-width: 700px) {
      .pv-order {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .pv-order-code {
        grid-column: 1 / -1;
        font-size: 0.85rem;
        color: var(--color-text-muted);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .pv-chev {
        transition: none;
      }
    }
  `,
})
export class ProjectsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(ManagerStore);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(ToastService);

  protected readonly NEW_PROJECT = NEW_PROJECT;
  protected readonly INPUT_CLASS = INPUT_CLASS;
  private readonly api = inject(ApiClient);
  /** Administrator: adds, edits and archives projects and objects, and decides who leads them. */
  protected readonly canManage = this.store.isAdmin;

  protected readonly editing = signal<{ readonly kind: 'PROJECT' | 'SITE'; readonly id: string } | null>(null);
  protected readonly editName = signal('');
  protected readonly editCity = signal('');
  protected readonly editModel = signal('');
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly confirmArchive = signal(false);
  private readonly accounts = signal<readonly AdminUser[] | null>(null);
  /** Who can be chosen: active managers for a project, active foremen for an object. */
  protected readonly candidates = computed(() => {
    const e = this.editing();
    const list = this.accounts();
    if (!e || !list) return null;
    const role = e.kind === 'PROJECT' ? 'MANAGER' : 'FOREMAN';
    return list.filter((u) => u.active && u.role === role);
  });
  /** Which add form is open: NEW_PROJECT, a project id (new object in it), or none. */
  protected readonly adding = signal<string | null>(null);
  protected readonly formCode = signal('');
  protected readonly formName = signal('');
  protected readonly formCity = signal('');
  protected readonly formModel = signal('');
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly query = signal('');
  protected readonly showCompleted = signal(false);
  protected readonly kpi = signal<Kpi>('ALL');
  /** Projects the manager unfolded; with many projects the list starts folded. */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected readonly ready = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s : null;
  });
  protected readonly siteCount = computed(() => (this.ready()?.data.projects ?? []).reduce((n, p) => n + p.sites.length, 0));

  /** Figures over every project, independent of search and filter, for the summary cards. */
  protected readonly portfolio = computed(() => {
    const projects = this.ready()?.data.projects ?? [];
    const orders = projects.flatMap((p) => p.orders.filter((o) => o.published));
    const open = orders.filter((o) => o.status !== 'COMPLETED');
    return {
      projects: projects.length,
      sites: this.siteCount(),
      open: open.length,
      inProgress: open.filter((o) => o.status === 'IN_PROGRESS').length,
      issues: orders.filter((o) => o.status === 'ISSUE').length,
      issueProjects: projects.filter((p) => p.orders.some((o) => o.status === 'ISSUE')).length,
      due: open.filter(dueSoon).length,
      hours: minutesToHours(orders.reduce((m, o) => m + o.minutesTotal, 0)),
    };
  });

  protected readonly blocks = computed<readonly ProjectBlock[]>(() => {
    const kpi = this.kpi();
    const matches = (b: ProjectBlock): boolean =>
      kpi === 'ALL' || (kpi === 'OPEN' && b.open > 0) || (kpi === 'ISSUE' && b.issues > 0) || (kpi === 'DUE' && b.due > 0);
    // Problems first, then what is due, then the busiest: the list reads as a worklist, not an archive.
    return this.allBlocks()
      .filter(matches)
      .slice()
      .sort((a, b) => b.issues - a.issues || b.due - a.due || b.open - a.open || a.summary.project.name.localeCompare(b.summary.project.name));
  });

  private readonly allBlocks = computed<readonly ProjectBlock[]>(() => {
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
        .map(({ site, orders }) => {
          const mine = summary.orders.filter((o) => o.siteId === site.id && o.published);
          return {
            site,
            orders,
            open: mine.filter((o) => o.status !== 'COMPLETED').length,
            issues: mine.filter((o) => o.status === 'ISSUE').length,
          };
        });
      // A project without objects (e.g. just added) still shows, so its first object can be added.
      if (!sites.length && !(projectHit && summary.sites.length === 0)) return [];
      const published = summary.orders.filter((o) => o.published);
      const count = (st: WorkOrderStatus): number => published.filter((o) => o.status === st).length;
      return [
        {
          summary,
          sites,
          total: summary.orders.length,
          open: summary.orders.filter((o) => o.published && o.status !== 'COMPLETED').length,
          hours: minutesToHours(summary.orders.reduce((m, o) => m + o.minutesTotal, 0)),
          issues: count('ISSUE'),
          due: published.filter(dueSoon).length,
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

  protected names(people: readonly CrewMember[]): string {
    return people.map((m) => m.displayName).join(', ');
  }

  protected foremenOf(p: ProjectBlock, siteId: string): readonly CrewMember[] {
    return p.summary.foremen[siteId] ?? [];
  }

  protected readonly houseCategories = HOUSE_CATEGORIES;

  protected modelsOf(category: HouseCategory): readonly HouseModel[] {
    return HOUSE_CATALOG.filter((m) => m.category === category);
  }

  protected houseOf(site: Site): HouseModel | null {
    return houseModel(site.houseModel);
  }

  protected catKey(category: HouseCategory): TranslationKey {
    return `projects.cat${category}` as TranslationKey;
  }

  protected chipKey(category: HouseCategory): TranslationKey {
    return `projects.chip${category}` as TranslationKey;
  }

  /**
   * A chosen house fills in the name when the field is empty or still holds the previous house's name; a name
   * the administrator typed is never overwritten.
   */
  private applyModel(model: string, current: () => string, setModel: (v: string) => void, setName: (v: string) => void, previous: string): void {
    const before = houseModel(previous)?.name ?? '';
    setModel(model);
    const next = houseModel(model);
    if (next && (!current().trim() || current().trim() === before)) setName(next.name);
  }

  protected readonly pickNewModel = (model: string): void =>
    this.applyModel(model, () => this.formName(), (v) => this.formModel.set(v), (v) => this.formName.set(v), this.formModel());

  protected readonly pickEditModel = (model: string): void =>
    this.applyModel(model, () => this.editName(), (v) => this.editModel.set(v), (v) => this.editName.set(v), this.editModel());

  protected openEdit(kind: 'PROJECT' | 'SITE', id: string, name: string, city: string, leads: readonly CrewMember[], model: string | null = null): void {
    this.closeForm();
    this.editing.set({ kind, id });
    this.editName.set(name);
    this.editCity.set(city);
    this.editModel.set(model ?? '');
    this.picked.set(new Set(leads.map((m) => m.id)));
    this.confirmArchive.set(false);
    this.formError.set(null);
    if (!this.accounts()) {
      this.api.adminUsers().then(
        (res) => this.accounts.set(res.users),
        (err: unknown) => {
          console.warn('[AON] accounts load failed', err);
          this.accounts.set([]);
          this.formError.set(this.i18n.t('projects.errFailed'));
        },
      );
    }
  }

  protected closeEdit(): void {
    this.editing.set(null);
    this.confirmArchive.set(false);
    this.formError.set(null);
  }

  protected togglePick(id: string): void {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }

  protected async saveEdit(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    const name = this.editName().trim();
    if (!name) {
      this.formError.set(this.i18n.t('projects.errName'));
      return;
    }
    const userIds = [...this.picked()];
    await this.persist(async () => {
      if (e.kind === 'PROJECT') {
        await this.api.updateProject(e.id, { name });
        await this.api.setProjectManagers(e.id, { userIds });
      } else {
        await this.api.updateSite(e.id, { name, city: this.editCity().trim(), houseModel: this.editModel() || null });
        await this.api.setSiteForemen(e.id, { userIds });
      }
      void this.store.loadDirectory();
      this.toast.success(this.i18n.t('projects.saved'));
      this.closeEdit();
    });
  }

  /** Two presses: the first asks, the second archives. Records stay; the project or object leaves the lists. */
  protected async archive(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!this.confirmArchive()) {
      this.confirmArchive.set(true);
      return;
    }
    await this.persist(async () => {
      if (e.kind === 'PROJECT') await this.api.updateProject(e.id, { active: false });
      else await this.api.updateSite(e.id, { active: false });
      void this.store.loadDirectory();
      this.toast.success(this.i18n.t('projects.archived'));
      this.closeEdit();
    }, 'projects.errArchiveOpen');
  }

  protected openForm(target: string): void {
    this.editing.set(null);
    this.adding.set(target);
    this.formCode.set('');
    this.formName.set('');
    this.formCity.set('');
    this.formModel.set('');
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
      const site = await this.store.createSite({ projectId, ...input, city: this.formCity().trim(), houseModel: this.formModel() || null });
      this.toast.success(this.i18n.t('projects.siteCreated', { name: site.name }));
      this.closeForm();
    });
  }

  /** Name is required; a code only when the administrator wants their own (the server numbers the rest). */
  private readForm(): { code?: string; name: string } | null {
    const code = this.formCode().trim().toUpperCase();
    const name = this.formName().trim();
    if (!name) {
      this.formError.set(this.i18n.t('projects.errRequired'));
      return null;
    }
    if (code && !CODE_PATTERN.test(code)) {
      this.formError.set(this.i18n.t('projects.errCode'));
      return null;
    }
    return code ? { code, name } : { name };
  }

  private async persist(write: () => Promise<void>, conflictKey: TranslationKey = 'projects.errCodeTaken'): Promise<void> {
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
      this.formError.set(this.i18n.t(err instanceof ApiError && err.kind === 'CONFLICT' ? conflictKey : 'projects.errFailed'));
    } finally {
      this.saving.set(false);
    }
  }

  /** Status dots shown, in legend order; pressing one shows only that status, pressing it again shows all. */
  protected readonly legendStatuses: readonly WorkOrderStatus[] = ['ISSUE', 'IN_PROGRESS', 'NEW', 'COMPLETED'];
  protected readonly statusFilter = signal<WorkOrderStatus | null>(null);

  protected readonly statusCounts = computed(() => {
    const counts: Record<WorkOrderStatus, number> = { NEW: 0, IN_PROGRESS: 0, COMPLETED: 0, ISSUE: 0 };
    for (const p of this.ready()?.data.projects ?? []) for (const o of p.orders) if (o.published) counts[o.status]++;
    return counts;
  });

  protected toggleStatus(st: WorkOrderStatus): void {
    this.statusFilter.set(this.statusFilter() === st ? null : st);
  }

  protected dimmed(st: WorkOrderStatus): boolean {
    const f = this.statusFilter();
    return f !== null && f !== st;
  }

  protected statusKey(st: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${st}`;
  }

  /** Deadline axis: three days back (late) to fourteen ahead. */
  private static readonly AXIS_FROM = -3;
  private static readonly AXIS_DAYS = 17;
  protected readonly lateWidth = (3 / 17) * 100;
  protected readonly todayLeft = (3 / 17) * 100;
  protected readonly ticks = [
    { day: -3, left: 0, label: '−3' },
    { day: 0, left: (3 / 17) * 100, label: this.i18n.t('projects.today') },
    { day: 7, left: (10 / 17) * 100, label: '+7' },
    { day: 14, left: (17 / 17) * 100, label: '+14' },
  ];

  protected dueOrders(p: ProjectBlock): readonly ProjectOrderRow[] {
    return p.summary.orders.filter((o) => o.published && o.status !== 'COMPLETED' && o.dueDate);
  }

  protected dueLeft(o: ProjectOrderRow): number {
    if (!o.dueDate) return 0;
    const today = new Date(`${isoDay(0)}T00:00:00`).getTime();
    const due = new Date(`${o.dueDate}T00:00:00`).getTime();
    const days = Math.round((due - today) / 86_400_000);
    const clamped = Math.min(Math.max(days, ProjectsComponent.AXIS_FROM), ProjectsComponent.AXIS_FROM + ProjectsComponent.AXIS_DAYS);
    return ((clamped - ProjectsComponent.AXIS_FROM) / ProjectsComponent.AXIS_DAYS) * 100;
  }

  /** Every published order with its project's name, for the lists inside the summary cards. */
  private readonly allOrders = computed(() =>
    (this.ready()?.data.projects ?? []).flatMap((p) => p.orders.filter((o) => o.published).map((o) => ({ ...o, projectName: p.project.name }))),
  );
  protected readonly problemOrders = computed(() => this.allOrders().filter((o) => o.status === 'ISSUE'));
  protected readonly dueOrdersAll = computed(() =>
    this.allOrders()
      .filter(dueSoon)
      .slice()
      .sort((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? '')),
  );
  /** The orders behind the chosen figure, problems and nearest deadlines first. */
  protected readonly kpiOrders = computed(() => {
    const k = this.kpi();
    const list =
      k === 'ISSUE' ? this.problemOrders() : k === 'DUE' ? this.dueOrdersAll() : k === 'OPEN' ? this.allOrders().filter((o) => o.status !== 'COMPLETED') : [];
    const rank = (o: { status: WorkOrderStatus }): number => (o.status === 'ISSUE' ? 0 : o.status === 'IN_PROGRESS' ? 1 : 2);
    return k === 'DUE' ? list : list.slice().sort((x, y) => rank(x) - rank(y) || (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999'));
  });
  protected readonly kcTabs = computed(() => {
    const f = this.portfolio();
    return [
      { key: 'ALL' as const, label: 'projects.kpiProjects' as const, icon: 'folder' as const, value: f.projects },
      { key: 'OPEN' as const, label: 'projects.kpiOpen' as const, icon: 'clipboard' as const, value: f.open },
      { key: 'ISSUE' as const, label: 'projects.kpiIssues' as const, icon: 'alert' as const, value: f.issues },
      { key: 'DUE' as const, label: 'projects.kpiDue' as const, icon: 'calendar' as const, value: f.due },
    ];
  });

  protected isLate(o: { dueDate: string | null; status: WorkOrderStatus }): boolean {
    return !!o.dueDate && o.status !== 'COMPLETED' && o.dueDate < isoDay(0);
  }

  protected setKpi(k: Kpi): void {
    this.kpi.set(this.kpi() === k ? 'ALL' : k);
  }

  protected kpiLabel(k: Kpi): string {
    const key = ({ ALL: 'projects.kpiProjects', OPEN: 'projects.kpiOpen', ISSUE: 'projects.kpiIssues', DUE: 'projects.kpiDue' } as const)[k];
    return this.i18n.t(key);
  }

  /** A search unfolds every match; otherwise a project is open only when the manager opened it. */
  protected isOpen(id: string): boolean {
    return !!this.query().trim() || this.opened().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.opened());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.opened.set(next);
  }


  protected isDueSoon(o: ProjectOrderRow): boolean {
    return dueSoon(o);
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
