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
      class="m-auto mb-0 max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto border-0 bg-stock p-0 text-ink backdrop:bg-charcoal/80 sm:mb-auto"
      [attr.aria-labelledby]="titleId"
      (cancel)="$event.preventDefault(); declined.emit()"
    >
      <div class="flex items-center gap-3 bg-charcoal px-5 py-4 text-white">
        <aon-icon [name]="icon()" [size]="26" [stroke]="2.5" class="text-gold" />
        <h2 [id]="titleId" class="font-cond text-[1.75rem] leading-tight">{{ heading() }}</h2>
      </div>
      <ul class="divide-y-2 divide-ground-deep px-5">
        @for (p of points(); track $index) {
          <li class="flex gap-3 py-3.5">
            <aon-icon [name]="p.icon" [size]="22" class="mt-0.5 shrink-0" />
            <p class="leading-snug">{{ p.text }}</p>
          </li>
        }
      </ul>
      <div class="grid gap-2 px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-2">
        <a routerLink="/privacy" class="inline-flex min-h-12 items-center gap-2 font-bold underline" (click)="dialog.close()">
          <aon-icon name="file" [size]="18" />{{ i18n.t('login.privacyLink') }}
        </a>
        <button type="button" class="flex min-h-16 items-center justify-between bg-gold px-6 text-left font-cond text-xl text-ink" (click)="accepted.emit()">
          {{ acceptLabel() }}<aon-icon name="check" [size]="26" [stroke]="3" />
        </button>
        @if (declineLabel()) {
          <button type="button" class="min-h-14 bg-stock px-6 font-cond text-lg ring-2 ring-inset ring-charcoal" (click)="declined.emit()">
            {{ declineLabel() }}
          </button>
        }
      </div>
    </dialog>
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
