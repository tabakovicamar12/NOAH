import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { QUANTITY_UNITS, type IsoDate, type Material, type QuantityUnit, type WorkOrder, type WorkOrderStatus } from '../../core/models/domain.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ToastService } from '../../core/ui/toast.service';
import { isIsoDate, toIsoDate, uuid } from '../../core/util/util';
import { hoursLabel } from '../../shared/ui/format';
import { IconComponent } from '../../shared/ui/icon.component';
import { TAG_FILL } from '../../shared/ui/tag-style';
import { ManagerStore } from './data/manager-store.service';

type FieldError = 'site' | 'title' | 'plannedQty' | 'crew' | 'estimate' | 'due';

interface MaterialRow {
  readonly key: number;
  readonly name: string;
  readonly qty: string;
  readonly unit: string;
}

/**
 * Create, edit or duplicate a work order. The live tag beside the form is exactly what the crew will see.
 * Saves go through the offline queue; the server issues the order number when it receives the order.
 */
@Component({
  selector: 'aon-order-form',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <header class="flex flex-wrap items-center gap-3">
        <a routerLink="/m" class="grid size-12 shrink-0 place-items-center border-2 border-charcoal bg-stock text-ink" [attr.aria-label]="i18n.t('common.back')">
          <aon-icon name="arrow-left" [size]="22" [stroke]="2.5" />
        </a>
        <div class="min-w-0">
          <h1 class="font-cond-tight text-[2.25rem] leading-none sm:text-5xl">{{ i18n.t(heading()) }}</h1>
          @if (sourceCode()) {
            <p class="mt-1 font-semibold text-ink-muted">{{ i18n.t(mode() === 'duplicate' ? 'form.copyOf' : 'form.editing', { code: sourceCode() ?? '' }) }}</p>
          }
        </div>
      </header>

      @if (store.directoryState() === 'CACHED' || !network.online()) {
        <p class="mt-5 flex items-start gap-2 border-2 border-dashed border-charcoal bg-stock px-4 py-3 font-semibold" role="status">
          <aon-icon name="cloud-off" [size]="20" class="text-hold" />{{ i18n.t('form.offline') }}
        </p>
      }
      @if (store.directoryState() === 'UNAVAILABLE') {
        <p class="mt-5 flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
          <aon-icon name="alert" [size]="20" />{{ i18n.t('form.noDirectory') }}
        </p>
      }
      @if (showErrors() && shownErrors().length) {
        <div class="mt-5 border-2 border-hold bg-hold-pale px-4 py-3 text-hold-ink" role="alert" tabindex="-1">
          <p class="flex items-center gap-2 font-cond text-xl"><aon-icon name="alert" [size]="20" />{{ i18n.t('form.fixErrors', { n: shownErrors().length }) }}</p>
          <ul class="mt-1 list-inside list-disc font-semibold">
            @for (e of shownErrors(); track e) {
              <li>{{ i18n.t(errorKey(e)) }}</li>
            }
          </ul>
        </div>
      }

      <div class="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start xl:gap-12">
        <!-- Live preview: first on small screens, beside the form on wide ones. -->
        <aside class="lg:sticky lg:top-6 lg:order-2" [attr.aria-label]="i18n.t('form.previewLabel')">
          <div class="mx-auto max-w-sm border-2 border-charcoal bg-ground px-3 pb-4 pt-3">
            <div class="flex items-center justify-between bg-charcoal px-3 py-2 text-white">
              <span class="font-cond-tight text-xl tracking-wide">AON</span>
              <span class="ml-3 min-w-0 truncate label-caps text-on-dark-muted">{{ preview().crewLine }}</span>
            </div>
            <div class="mt-3" [class.tag-outline]="preview().status === 'NEW'">
              <div class="tag-shape py-4 pr-4" [class]="previewFill().cls">
                <span class="tag-eyelet"></span>
                <div class="flex items-start justify-between gap-3">
                  <p class="font-cond-tight text-[1.9rem] leading-none" [class.opacity-60]="!preview().code">{{ preview().code ?? i18n.t('form.numberPending') }}</p>
                  <span class="flex items-center gap-1 label-caps" [class]="previewFill().muted">
                    <aon-icon [name]="previewFill().icon" [size]="14" [stroke]="3" />{{ i18n.t(statusKey(preview().status)) }}
                  </span>
                </div>
                <p class="mt-1 text-lg font-bold leading-snug" [class.text-ink-muted]="!title().trim()">{{ title().trim() || i18n.t('form.titlePlaceholder') }}</p>
                <p class="mt-0.5 flex items-start gap-1.5 text-[0.9rem] font-semibold" [class]="previewFill().muted">
                  <aon-icon name="pin" [size]="15" class="mt-0.5" />{{ preview().where }}
                </p>
                <p class="mt-2 flex flex-wrap gap-x-3 text-[0.9rem] font-semibold" [class]="previewFill().muted">
                  <span>{{ preview().plan }}</span>
                  @if (preview().estimate) {
                    <span>{{ preview().estimate }}</span>
                  }
                  @if (dueDate()) {
                    <span>{{ i18n.t('orders.due', { date: i18n.date(dueDate()) }) }}</span>
                  }
                </p>
              </div>
            </div>
            @if (materialsClean().length) {
              <p class="mt-3 flex items-center gap-1.5 px-1 text-sm font-semibold text-ink-muted">
                <aon-icon name="package" [size]="16" />{{ i18n.t('form.previewMaterials', { n: materialsClean().length }) }}
              </p>
            }
          </div>
          <p class="mx-auto mt-2 max-w-sm text-sm font-semibold text-ink-muted">{{ i18n.t('form.previewCaption') }}</p>
        </aside>

        <form class="grid gap-9 lg:order-1" novalidate (submit)="$event.preventDefault()">
          <!-- Where -->
          <fieldset class="grid gap-4">
            <legend class="w-full border-b-2 border-charcoal pb-1 font-cond text-2xl">{{ i18n.t('form.where') }}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.project') }}</span>
                <select
                  class="field mt-1"
                  [disabled]="siteLocked()"
                  [value]="projectId()"
                  (change)="pickProject($any($event.target).value)"
                >
                  <option value="" disabled>{{ i18n.t('form.choose') }}</option>
                  @for (p of projects(); track p.id) {
                    <option [value]="p.id" [selected]="p.id === projectId()">{{ p.code }} · {{ p.name }}</option>
                  }
                </select>
              </label>
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.site') }}</span>
                <select
                  class="field mt-1"
                  [class.invalid]="showErrors() && has('site')"
                  [disabled]="siteLocked() || !projectId()"
                  [attr.aria-invalid]="showErrors() && has('site')"
                  (change)="siteId.set($any($event.target).value)"
                >
                  <option value="" disabled [selected]="!siteId()">{{ i18n.t('form.choose') }}</option>
                  @for (s of sitesForProject(); track s.id) {
                    <option [value]="s.id" [selected]="s.id === siteId()">{{ s.name }}</option>
                  }
                </select>
                @if (showErrors() && has('site')) {
                  <span class="err">{{ i18n.t('form.err.site') }}</span>
                }
              </label>
            </div>
            @if (siteLocked()) {
              <p class="flex items-center gap-2 text-sm font-semibold text-ink-muted"><aon-icon name="lock" [size]="16" />{{ i18n.t('form.siteLocked') }}</p>
            }
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('form.location') }}</span>
              <input type="text" maxlength="140" class="field mt-1" [placeholder]="i18n.t('form.locationPlaceholder')" [value]="location()" (input)="location.set($any($event.target).value)" />
            </label>
          </fieldset>

          <!-- Task -->
          <fieldset class="grid gap-4">
            <legend class="w-full border-b-2 border-charcoal pb-1 font-cond text-2xl">{{ i18n.t('form.task') }}</legend>
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('form.title') }}</span>
              <input
                type="text"
                maxlength="140"
                class="field mt-1 text-lg font-bold"
                [class.invalid]="showErrors() && has('title')"
                [attr.aria-invalid]="showErrors() && has('title')"
                [placeholder]="i18n.t('form.titlePlaceholder')"
                [value]="title()"
                (input)="title.set($any($event.target).value)"
              />
              @if (showErrors() && has('title')) {
                <span class="err">{{ i18n.t('form.err.title') }}</span>
              }
            </label>
            <label class="block">
              <span class="label-caps text-ink-muted">{{ i18n.t('form.description') }}</span>
              <textarea rows="4" maxlength="4000" class="field mt-1 py-2 leading-snug" [placeholder]="i18n.t('form.descriptionPlaceholder')" [value]="description()" (input)="description.set($any($event.target).value)"></textarea>
            </label>
          </fieldset>

          <!-- Crew -->
          <fieldset class="grid gap-3">
            <legend class="flex w-full items-baseline justify-between border-b-2 border-charcoal pb-1">
              <span class="font-cond text-2xl">{{ i18n.t('form.crew') }}</span>
              <span class="label-caps text-ink-muted">{{ i18n.t('form.crewSelected', { n: crewIds().length }) }}</span>
            </legend>
            <p class="text-[0.95rem] text-ink-muted">{{ i18n.t('form.crewHint') }}</p>
            @if (workers().length > 10) {
              <label class="relative block sm:w-80">
                <span class="sr-only">{{ i18n.t('form.crewSearch') }}</span>
                <aon-icon name="search" [size]="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input type="search" class="field pl-10" [placeholder]="i18n.t('form.crewSearch')" [value]="crewQuery()" (input)="crewQuery.set($any($event.target).value)" />
              </label>
            }
            <ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" [class.invalid-group]="showErrors() && has('crew')">
              @for (w of visibleWorkers(); track w.user.id) {
                @let on = crewIds().includes(w.user.id);
                @let locked = lockedCrew().has(w.user.id) && on;
                <li>
                  <button
                    type="button"
                    class="flex min-h-14 w-full items-center gap-3 px-3 text-left"
                    [class]="on ? 'bg-charcoal text-white' : 'bg-stock ring-2 ring-inset ring-charcoal hover:bg-ground-deep'"
                    [attr.aria-pressed]="on"
                    [attr.aria-disabled]="locked"
                    [title]="locked ? i18n.t('form.crewLocked') : ''"
                    (click)="toggleWorker(w.user.id)"
                  >
                    <span class="grid size-7 shrink-0 place-items-center" [class]="on ? 'bg-gold text-ink' : 'ring-2 ring-inset ring-charcoal'">
                      @if (locked) {
                        <aon-icon name="lock" [size]="15" [stroke]="2.75" />
                      } @else if (on) {
                        <aon-icon name="check" [size]="16" [stroke]="3.25" />
                      }
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-bold leading-tight">{{ w.user.displayName }}</span>
                      <span class="block truncate text-sm" [class]="on ? 'text-on-dark-muted' : 'text-ink-muted'">
                        {{ w.user.crew }} · {{ i18n.t('form.openOrders', { n: w.openOrders }) }}
                      </span>
                    </span>
                  </button>
                </li>
              }
            </ul>
            @if (showErrors() && has('crew')) {
              <span class="err">{{ i18n.t('form.err.crew') }}</span>
            }
            @if (lockedCrew().size && crewIds().length) {
              <p class="flex items-center gap-2 text-sm font-semibold text-ink-muted"><aon-icon name="lock" [size]="16" />{{ i18n.t('form.crewLocked') }}</p>
            }
          </fieldset>

          <!-- Plan -->
          <fieldset class="grid gap-4">
            <legend class="w-full border-b-2 border-charcoal pb-1 font-cond text-2xl">{{ i18n.t('form.plan') }}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.date') }}</span>
                <input type="date" class="field mt-1" [value]="date()" (input)="date.set($any($event.target).value)" />
              </label>
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.due') }}</span>
                <input
                  type="date"
                  class="field mt-1"
                  [class.invalid]="showErrors() && has('due')"
                  [min]="date() || null"
                  [value]="dueDate()"
                  (input)="dueDate.set($any($event.target).value)"
                />
                @if (showErrors() && has('due')) {
                  <span class="err">{{ i18n.t('form.err.due') }}</span>
                }
              </label>
            </div>
            <div class="grid gap-4 sm:grid-cols-[1fr_9rem_1fr]">
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.plannedQty') }}</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="any"
                  class="field mt-1 font-cond text-2xl"
                  [class.invalid]="showErrors() && has('plannedQty')"
                  [attr.aria-invalid]="showErrors() && has('plannedQty')"
                  [disabled]="siteLocked()"
                  [value]="plannedQty()"
                  (input)="plannedQty.set($any($event.target).value)"
                />
                @if (showErrors() && has('plannedQty')) {
                  <span class="err">{{ i18n.t('form.err.plannedQty') }}</span>
                }
              </label>
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.unit') }}</span>
                <select class="field mt-1" [disabled]="siteLocked()" (change)="unit.set($any($event.target).value)">
                  @for (u of units; track u) {
                    <option [value]="u" [selected]="u === unit()">{{ i18n.t(unitKey(u)) }}</option>
                  }
                </select>
              </label>
              <label class="block">
                <span class="label-caps text-ink-muted">{{ i18n.t('form.estimate') }}</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.5"
                  class="field mt-1 font-cond text-2xl"
                  [class.invalid]="showErrors() && has('estimate')"
                  [placeholder]="i18n.t('form.estimatePlaceholder')"
                  [value]="estimateHours()"
                  (input)="estimateHours.set($any($event.target).value)"
                />
                @if (showErrors() && has('estimate')) {
                  <span class="err">{{ i18n.t('form.err.estimate') }}</span>
                }
              </label>
            </div>
          </fieldset>

          <!-- Materials -->
          <fieldset class="grid gap-3">
            <legend class="w-full border-b-2 border-charcoal pb-1 font-cond text-2xl">{{ i18n.t('order.materials') }}</legend>
            @if (materials().length) {
              <ul class="grid gap-2">
                @for (m of materials(); track m.key; let i = $index) {
                  <li class="grid grid-cols-[minmax(0,1fr)_4.5rem_3.75rem_3rem] gap-1.5 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_3rem] sm:gap-2">
                    <input type="text" maxlength="80" class="field" [attr.aria-label]="i18n.t('form.materialName')" [placeholder]="i18n.t('form.materialPlaceholder')" [value]="m.name" (input)="setMaterial(i, { name: $any($event.target).value })" />
                    <input type="number" inputmode="decimal" min="0" step="any" class="field text-right font-cond text-xl" [attr.aria-label]="i18n.t('form.materialQty', { name: m.name })" [value]="m.qty" (input)="setMaterial(i, { qty: $any($event.target).value })" />
                    <input type="text" maxlength="12" class="field text-center" [attr.aria-label]="i18n.t('form.materialUnit')" [placeholder]="i18n.t('unit.PCS')" [value]="m.unit" (input)="setMaterial(i, { unit: $any($event.target).value })" />
                    <button type="button" class="grid min-h-12 place-items-center ring-2 ring-inset ring-charcoal hover:bg-ground-deep" [attr.aria-label]="i18n.t('form.removeMaterial', { name: m.name })" (click)="removeMaterial(i)">
                      <aon-icon name="x" [size]="20" />
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-[0.95rem] text-ink-muted">{{ i18n.t('form.noMaterials') }}</p>
            }
            <button type="button" class="flex min-h-12 w-fit items-center gap-2 px-4 font-cond text-lg ring-2 ring-inset ring-charcoal hover:bg-ground-deep" (click)="addMaterial()">
              <aon-icon name="plus" [size]="18" [stroke]="3" />{{ i18n.t('form.addMaterial') }}
            </button>
          </fieldset>
        </form>
      </div>
    </div>

    <!-- Action bar -->
    <div class="fixed inset-x-0 bottom-0 z-40 border-t-2 border-charcoal bg-ground lg:left-60">
      <div class="flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
        <p class="mr-auto hidden text-sm font-semibold text-ink-muted sm:block">{{ i18n.t('form.queueNote') }}</p>
        @if (!isPublished()) {
          <button type="button" class="flex min-h-14 items-center gap-2 bg-stock px-5 font-cond text-xl ring-2 ring-inset ring-charcoal hover:bg-ground-deep disabled:opacity-50" [disabled]="busy()" (click)="save(false)">
            <aon-icon name="note" [size]="20" />{{ i18n.t('form.saveDraft') }}
          </button>
        }
        <button type="button" class="flex min-h-14 items-center gap-2 bg-gold px-6 font-cond text-xl text-ink hover:brightness-95 disabled:opacity-50" [disabled]="busy()" (click)="save(true)">
          <aon-icon name="check" [size]="22" [stroke]="3" />{{ isPublished() ? i18n.t('form.saveChanges') : i18n.t('form.assign') }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .field {
      display: block;
      width: 100%;
      min-height: 3.5rem;
      border: 2px solid var(--color-charcoal);
      background: #fff;
      padding: 0 0.85rem;
      font-weight: 600;
      outline: none;
    }
    textarea.field {
      padding-top: 0.6rem;
      padding-bottom: 0.6rem;
    }
    .field::placeholder {
      font-weight: 400;
      color: var(--color-ink-muted);
    }
    .field:focus-visible {
      box-shadow: 0 0 0 4px var(--color-gold);
      outline: none;
    }
    .field:disabled {
      background: var(--color-ground-deep);
      color: var(--color-ink-muted);
      cursor: not-allowed;
    }
    .field.invalid {
      border-color: var(--color-hold);
      box-shadow: inset 0 0 0 1px var(--color-hold);
    }
    .invalid-group {
      outline: 2px solid var(--color-hold);
      outline-offset: 4px;
    }
    .err {
      display: block;
      margin-top: 0.3rem;
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--color-hold-ink);
    }
  `,
})
export class OrderFormComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(ManagerStore);
  protected readonly network = inject(NetworkStatusService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Route param for /m/orders/:id/edit. */
  readonly id = input<string | undefined>(undefined);
  /** Query param ?from=<orderId> for duplicating. */
  readonly from = input<string | undefined>(undefined);
  /** Query param ?site=<siteId> from the projects list: the order starts on that object. */
  readonly site = input<string | undefined>(undefined);

  protected readonly units = QUANTITY_UNITS;

  protected readonly projectId = signal('');
  protected readonly siteId = signal('');
  protected readonly location = signal('');
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly crewIds = signal<readonly string[]>([]);
  protected readonly crewQuery = signal('');
  protected readonly date = signal<string>(toIsoDate());
  protected readonly dueDate = signal<string>('');
  protected readonly plannedQty = signal<string>('');
  protected readonly unit = signal<QuantityUnit>('PCS');
  protected readonly estimateHours = signal<string>('');
  protected readonly materials = signal<readonly MaterialRow[]>([]);
  protected readonly showErrors = signal(false);
  protected readonly busy = signal(false);

  private readonly source = signal<WorkOrder | null>(null);
  protected readonly lockedCrew = signal<ReadonlySet<string>>(new Set());
  private readonly workStarted = signal(false);
  private materialKey = 0;
  private readonly newId = uuid();

  protected readonly mode = computed<'create' | 'edit' | 'duplicate'>(() => (this.id() ? 'edit' : this.from() ? 'duplicate' : 'create'));
  protected readonly heading = computed<TranslationKey>(() =>
    this.mode() === 'edit' ? 'form.titleEdit' : this.mode() === 'duplicate' ? 'form.titleDuplicate' : 'form.titleNew',
  );
  protected readonly sourceCode = computed(() => this.source()?.code ?? null);
  protected readonly isPublished = computed(() => this.mode() === 'edit' && this.source()?.published === true);
  protected readonly siteLocked = computed(() => this.mode() === 'edit' && this.workStarted());

  protected readonly projects = computed(() => this.store.directory()?.projects ?? []);
  protected readonly sites = computed(() => this.store.directory()?.sites ?? []);
  protected readonly sitesForProject = computed(() => this.sites().filter((s) => s.projectId === this.projectId()));
  protected readonly workers = computed(() => this.store.directory()?.workers ?? []);
  protected readonly visibleWorkers = computed(() => {
    const q = this.crewQuery().trim().toLocaleLowerCase();
    const selected = new Set(this.crewIds());
    return this.workers().filter((w) => !q || selected.has(w.user.id) || `${w.user.displayName} ${w.user.crew ?? ''}`.toLocaleLowerCase().includes(q));
  });

  protected readonly materialsClean = computed<readonly Material[]>(() =>
    this.materials()
      .filter((m) => m.name.trim() !== '')
      .map((m) => {
        const qty = parseNumber(m.qty);
        return { name: m.name.trim(), qty: qty !== null && qty >= 0 ? qty : null, unit: m.unit.trim() || null };
      }),
  );

  protected readonly errors = computed<readonly FieldError[]>(() => {
    const out: FieldError[] = [];
    if (!this.siteId()) out.push('site');
    if (!this.title().trim()) out.push('title');
    const q = parseNumber(this.plannedQty());
    if (q === null || q <= 0) out.push('plannedQty');
    const est = this.estimateHours().trim();
    if (est !== '' && (parseNumber(est) === null || (parseNumber(est) ?? 0) < 0)) out.push('estimate');
    if (this.dueDate() && this.date() && this.dueDate() < this.date()) out.push('due');
    return out;
  });
  /** Crew is required only when assigning, so it joins the list after an assign attempt. */
  private readonly crewMissing = signal(false);
  protected readonly shownErrors = computed<readonly FieldError[]>(() => [...this.errors(), ...(this.crewMissing() ? (['crew'] as const) : [])]);

  protected readonly preview = computed(() => {
    const site = this.sites().find((s) => s.id === this.siteId());
    const q = parseNumber(this.plannedQty());
    const est = parseNumber(this.estimateHours());
    const names = this.workers()
      .filter((w) => this.crewIds().includes(w.user.id))
      .map((w) => w.user.displayName.split(' ')[0] ?? '');
    const status: WorkOrderStatus = this.mode() === 'edit' ? (this.source()?.status ?? 'NEW') : 'NEW';
    return {
      code: this.mode() === 'edit' ? (this.source()?.code ?? null) : null,
      status,
      where: [this.location().trim(), site ? `${site.projectName} · ${site.name}` : this.i18n.t('form.sitePlaceholder')].filter(Boolean).join(' · '),
      plan: `0 / ${q !== null && q > 0 ? this.i18n.number(q) : '–'} ${this.i18n.t(this.unitKey(this.unit()))}`,
      estimate: est !== null && est > 0 ? hoursLabel(this.i18n, est * 60) : '',
      crewLine: names.length ? names.join(', ') : this.i18n.t('form.noCrew'),
    };
  });
  protected readonly previewFill = computed(() => TAG_FILL[this.preview().status]);

  constructor() {
    void this.store.loadDirectory();
    if (!this.store.overview()) void this.store.load();

    // Fill the form once from the order being edited or duplicated.
    effect(() => {
      const ref = this.id() ?? this.from();
      const known = ref ? this.findKnown(ref) : null;
      untracked(() => {
        if (ref && known && !this.source()) this.fill(known);
      });
    });
    effect(() => {
      const ref = this.id() ?? this.from();
      if (ref) untracked(() => void this.fetchSource(ref));
    });
    // Preselect the object passed from the projects list, once the directory is known.
    effect(() => {
      const wanted = this.site();
      const s = wanted ? this.sites().find((x) => x.id === wanted) : undefined;
      untracked(() => {
        if (s && !this.siteId() && this.mode() === 'create') {
          this.projectId.set(s.projectId);
          this.siteId.set(s.id);
        }
      });
    });
    // A project with a single object needs no second choice.
    effect(() => {
      const list = this.sitesForProject();
      untracked(() => {
        if (list.length === 1 && !this.siteId()) this.siteId.set(list[0]?.id ?? '');
      });
    });
  }

  protected statusKey(status: WorkOrderStatus): `status.${WorkOrderStatus}` {
    return `status.${status}`;
  }

  protected unitKey(unit: QuantityUnit): `unit.${QuantityUnit}` {
    return `unit.${unit}`;
  }

  protected errorKey(e: FieldError): TranslationKey {
    return `form.err.${e}`;
  }

  protected has(e: FieldError): boolean {
    return this.shownErrors().includes(e);
  }

  protected pickProject(id: string): void {
    this.projectId.set(id);
    if (!this.sitesForProject().some((s) => s.id === this.siteId())) this.siteId.set('');
  }

  protected toggleWorker(id: string): void {
    const on = this.crewIds().includes(id);
    if (on && this.lockedCrew().has(id)) {
      this.toast.show(this.i18n.t('form.crewLocked'));
      return;
    }
    this.crewIds.set(on ? this.crewIds().filter((x) => x !== id) : [...this.crewIds(), id]);
    if (!on) this.crewMissing.set(false);
  }

  protected addMaterial(): void {
    this.materials.update((list) => [...list, { key: this.materialKey++, name: '', qty: '', unit: '' }]);
  }

  protected setMaterial(index: number, change: Partial<Omit<MaterialRow, 'key'>>): void {
    this.materials.update((list) => list.map((m, i) => (i === index ? { ...m, ...change } : m)));
  }

  protected removeMaterial(index: number): void {
    this.materials.update((list) => list.filter((_, i) => i !== index));
  }

  protected async save(publish: boolean): Promise<void> {
    if (this.busy()) return;
    const crewNeeded = publish && this.crewIds().length === 0;
    this.crewMissing.set(crewNeeded);
    if (this.errors().length || crewNeeded) {
      this.showErrors.set(true);
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('[role="alert"][tabindex]')?.focus());
      return;
    }
    this.busy.set(true);
    try {
      const est = parseNumber(this.estimateHours());
      await this.store.saveOrder({
        id: this.mode() === 'edit' ? (this.id() ?? this.newId) : this.newId,
        title: this.title().trim(),
        description: this.description().trim(),
        siteId: this.siteId(),
        location: this.location().trim(),
        crewIds: this.crewIds(),
        published: publish || this.isPublished(),
        unit: this.unit(),
        plannedQty: parseNumber(this.plannedQty()) ?? 0,
        estimatedMinutes: est !== null && est > 0 ? Math.round(est * 60) : null,
        materials: this.materialsClean(),
        date: isIsoDate(this.date()) ? (this.date() as IsoDate) : null,
        dueDate: isIsoDate(this.dueDate()) ? (this.dueDate() as IsoDate) : null,
      });
      const online = this.network.online();
      this.toast.success(
        this.i18n.t(publish ? (online ? 'form.assignedToast' : 'form.assignedOfflineToast') : 'form.draftToast', {
          n: this.crewIds().length,
        }),
      );
    } catch (err: unknown) {
      console.error('[AON] order save failed', err);
      this.toast.error(this.i18n.t('common.errorGeneric'));
      this.busy.set(false);
      return;
    }
    // The order is saved; leaving the form is separate, so a failed navigation never reads as a failed save.
    this.busy.set(false);
    this.router.navigateByUrl('/m').catch((err: unknown) => console.warn('[AON] navigation after save failed', err));
  }

  /** The order as this device already knows it: a pending local save, else the cached overview. */
  private findKnown(ref: string): WorkOrder | null {
    const pending = this.store.authored().find((a) => a.id === ref);
    const site = pending ? this.sites().find((s) => s.id === pending.siteId) : undefined;
    if (pending) {
      return {
        id: pending.id,
        code: null,
        title: pending.title,
        description: pending.description,
        projectId: site?.projectId ?? '',
        siteId: pending.siteId,
        siteName: site ? `${site.projectName} · ${site.name}` : '',
        location: pending.location,
        crew: pending.crewIds.map((id) => ({ id, displayName: this.workers().find((w) => w.user.id === id)?.user.displayName ?? id })),
        managerId: this.session.user()?.id ?? '',
        managerName: this.session.user()?.displayName ?? '',
        status: 'NEW',
        published: pending.published,
        unit: pending.unit,
        plannedQty: pending.plannedQty,
        doneQty: 0,
        estimatedMinutes: pending.estimatedMinutes,
        materials: pending.materials,
        date: pending.date,
        dueDate: pending.dueDate,
        updatedAt: pending.savedAt,
      };
    }
    return this.store.overview()?.orders.find((r) => r.order.id === ref)?.order ?? null;
  }

  private async fetchSource(ref: string): Promise<void> {
    if (!this.network.online()) return;
    try {
      const detail = await this.store.detail(ref);
      if (!this.source()) this.fill(detail.order);
      if (this.mode() === 'edit') {
        this.lockedCrew.set(new Set(detail.lockedCrewIds));
        this.workStarted.set(detail.lockedCrewIds.length > 0);
      }
    } catch {
      /* not on the server yet (pending local order) or offline: the known copy is used */
    }
  }

  private fill(o: WorkOrder): void {
    const duplicate = this.mode() === 'duplicate';
    this.source.set(o);
    this.projectId.set(o.projectId);
    this.siteId.set(o.siteId);
    this.location.set(o.location);
    this.title.set(o.title);
    this.description.set(o.description);
    this.crewIds.set(o.crew.map((c) => c.id));
    this.date.set(duplicate ? toIsoDate() : (o.date ?? ''));
    this.dueDate.set(duplicate ? '' : (o.dueDate ?? ''));
    this.plannedQty.set(String(o.plannedQty));
    this.unit.set(o.unit);
    this.estimateHours.set(o.estimatedMinutes ? String(Math.round((o.estimatedMinutes / 60) * 10) / 10) : '');
    this.materials.set(o.materials.map((m) => ({ key: this.materialKey++, name: m.name, qty: m.qty === null ? '' : String(m.qty), unit: m.unit ?? '' })));
  }
}

function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
