import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from './icon.component';

/**
 * Confirmation before a permanent delete. Names what goes and what happens, focuses Cancel so Enter never deletes,
 * and for the widest deletes asks to type the item's code. Escape or the backdrop cancels.
 */
@Component({
  selector: 'aon-confirm-delete',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="sheet m-auto mb-0 max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto border-0 bg-white p-0 text-ink backdrop:bg-charcoal/60 sm:mb-auto"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="bodyId"
      (cancel)="$event.preventDefault(); cancel()"
      (click)="onBackdrop($event)"
    >
      <div>
        <div class="flex items-start gap-3 px-5 pb-1 pt-5">
          <span class="badge"><aon-icon name="trash" [size]="20" [stroke]="2" /></span>
          <h2 [id]="titleId" class="pt-1.5 text-lg font-semibold leading-tight">{{ heading() }}</h2>
        </div>
        <ul [id]="bodyId" class="points px-5">
          @for (p of points(); track $index) {
            <li class="flex gap-3 py-3">
              <aon-icon
                name="alert"
                [size]="18"
                class="mt-0.5 shrink-0 text-[var(--color-bad-ink)]"
              />
              <p class="text-[0.95rem] leading-snug">{{ p }}</p>
            </li>
          }
        </ul>
        @if (typeToConfirm(); as code) {
          <label class="mx-5 mt-1 block">
            <span class="text-[0.9rem]">{{ i18n.t('delete.typePrompt', { code }) }}</span>
            <input
              type="text"
              class="type-field"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              [value]="typed()"
              (input)="typed.set($any($event.target).value)"
            />
          </label>
        }
        @if (error(); as err) {
          <p class="err mx-5 mt-3" role="alert"><aon-icon name="alert" [size]="17" />{{ err }}</p>
        }
        <div
          class="grid gap-2 px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:grid-cols-2"
        >
          <button #cancelBtn type="button" class="act act-line" (click)="cancel()">
            {{ i18n.t('common.cancel') }}
          </button>
          <button
            type="button"
            class="act act-bad"
            [disabled]="busy() || !matches()"
            (click)="confirmed.emit()"
          >
            <aon-icon name="trash" [size]="17" [stroke]="2.25" />{{
              busy() ? i18n.t('delete.deleting') : confirmLabel()
            }}
          </button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    .sheet {
      border-radius: 1rem 1rem 0 0;
      font-family: var(--font-ui);
    }
    @media (min-width: 640px) {
      .sheet {
        border-radius: 1rem;
      }
    }
    .badge {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 9999px;
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
    }
    .points > li + li {
      border-top: 1px solid var(--color-line);
    }
    .type-field {
      display: block;
      width: 100%;
      min-height: 2.75rem;
      margin-top: 0.35rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .type-field:focus {
      outline: 3px solid var(--color-gold);
      outline-offset: 1px;
    }
    .err {
      display: flex;
      align-items: flex-start;
      gap: 0.4rem;
      color: var(--color-bad-ink);
      font-size: 0.93rem;
      font-weight: 600;
    }
    .act {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-height: 3rem;
      border-radius: 0.6rem;
      font-weight: 600;
    }
    .act-line {
      border: 1px solid var(--color-line-strong);
      background: #fff;
    }
    .act-bad {
      background: var(--color-bad);
      color: #fff;
    }
    .act-bad:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  `,
})
export class ConfirmDeleteComponent {
  protected readonly i18n = inject(I18nService);
  private static nextId = 0;
  private readonly uid = ConfirmDeleteComponent.nextId++;
  protected readonly titleId = `aon-del-title-${this.uid}`;
  protected readonly bodyId = `aon-del-body-${this.uid}`;

  readonly heading = input.required<string>();
  /** What will be deleted and what follows from it, one consequence per line. */
  readonly points = input.required<readonly string[]>();
  /** Names the action, e.g. "Izbriši projekt", never just "OK". */
  readonly confirmLabel = input.required<string>();
  /** When set, the delete button stays off until this exact code is typed. */
  readonly typeToConfirm = input<string | null>(null);
  readonly busy = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly typed = signal('');
  protected readonly matches = computed(() => {
    const code = this.typeToConfirm();
    return !code || this.typed().trim().toUpperCase() === code.toUpperCase();
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelBtn = viewChild.required<ElementRef<HTMLButtonElement>>('cancelBtn');

  constructor() {
    afterNextRender(() => {
      const el = this.dialog().nativeElement;
      try {
        el.showModal();
      } catch {
        el.setAttribute('open', '');
      }
      this.cancelBtn().nativeElement.focus();
    });
  }

  protected cancel(): void {
    if (!this.busy()) this.cancelled.emit();
  }

  /** A click on the dialog element itself (not its content) is a click on the backdrop. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.cancel();
  }
}
