import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent, type IconName } from './icon.component';

export interface NoticePoint {
  readonly icon: IconName;
  readonly text: string;
}

/**
 * A modal explanation shown before the app touches a sensor (camera, microphone). The primary button's
 * click is the user gesture that then opens the sensor, so nothing turns on without a deliberate tap.
 */
@Component({
  selector: 'aon-notice-sheet',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="sheet m-auto mb-0 max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto border-0 bg-white p-0 text-ink backdrop:bg-charcoal/60 sm:mb-auto"
      [attr.aria-labelledby]="titleId"
      (cancel)="$event.preventDefault(); declined.emit()"
    >
      <div class="flex items-center gap-3 px-5 pb-1 pt-5">
        <span class="badge"><aon-icon [name]="icon()" [size]="20" [stroke]="2" /></span>
        <h2 [id]="titleId" class="text-lg font-semibold leading-tight">{{ heading() }}</h2>
      </div>
      <ul class="points px-5">
        @for (p of points(); track $index) {
          <li class="flex gap-3 py-3">
            <aon-icon [name]="p.icon" [size]="18" class="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
            <p class="text-[0.95rem] leading-snug">{{ p.text }}</p>
          </li>
        }
      </ul>
      <div class="grid gap-2 px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-2">
        <a routerLink="/privacy" class="inline-flex min-h-11 items-center gap-2 text-[0.95rem] font-medium underline underline-offset-4" (click)="dialog.close()">
          <aon-icon name="file" [size]="16" />{{ i18n.t('login.privacyLink') }}
        </a>
        <button type="button" class="act act-gold" (click)="accepted.emit()">
          <aon-icon name="check" [size]="18" [stroke]="2.25" />{{ acceptLabel() }}
        </button>
        @if (declineLabel()) {
          <button type="button" class="act act-line" (click)="declined.emit()">
            {{ declineLabel() }}
          </button>
        }
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
      background: var(--color-gold-fill);
      color: var(--color-gold-ink);
    }
    .points > li + li {
      border-top: 1px solid var(--color-line);
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
    .act-gold {
      background: var(--color-gold);
      color: var(--color-charcoal);
    }
    .act-line {
      border: 1px solid var(--color-line-strong);
      background: #fff;
    }
  `,
})
export class NoticeSheetComponent {
  protected readonly i18n = inject(I18nService);
  private static nextId = 0;
  protected readonly titleId = `aon-notice-${NoticeSheetComponent.nextId++}`;

  readonly heading = input.required<string>();
  readonly icon = input<IconName>('shield');
  readonly points = input.required<readonly NoticePoint[]>();
  readonly acceptLabel = input.required<string>();
  readonly declineLabel = input<string>('');
  readonly accepted = output<void>();
  readonly declined = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    afterNextRender(() => {
      const el = this.dialog().nativeElement;
      try {
        el.showModal();
      } catch {
        el.setAttribute('open', '');
      }
    });
  }
}
