import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'aon-toast-outlet',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[60] flex flex-col items-center gap-2 px-4 lg:top-auto lg:bottom-6 lg:items-end lg:px-6 no-print',
  },
  template: `
    <div class="sr-only" aria-live="polite" aria-atomic="false">
      @for (t of toast.toasts(); track t.id) {
        @if (t.kind !== 'error') {
          <p>{{ t.text }}</p>
        }
      }
    </div>
    <div class="sr-only" role="alert" aria-live="assertive">
      @for (t of toast.toasts(); track t.id) {
        @if (t.kind === 'error') {
          <p>{{ t.text }}</p>
        }
      }
    </div>
    @for (t of toast.toasts(); track t.id) {
      <div
        class="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-[0.95rem] font-medium shadow-[0_16px_40px_-16px_rgb(20_20_20/0.45)]"
        [class]="t.kind === 'error' ? 'bg-[var(--color-bad)] text-white' : t.kind === 'success' ? 'bg-[var(--color-rail)] text-white' : 'border border-[var(--color-line)] bg-white text-ink'"
        aria-hidden="true"
      >
        <aon-icon
          [name]="t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'circle-check' : 'note'"
          [size]="19"
          [class]="t.kind === 'success' ? 'mt-0.5 text-gold' : 'mt-0.5'"
        />
        <p class="flex-1 leading-snug">{{ t.text }}</p>
        <button type="button" class="-m-2 grid size-11 place-items-center rounded-lg opacity-70 hover:opacity-100" (click)="toast.dismiss(t.id)" tabindex="-1">
          <aon-icon name="x" [size]="18" />
        </button>
      </div>
    }
  `,
  styles: `
    .toast-in {
      animation: toast-in 280ms var(--ease-out-expo) both;
    }
    @keyframes toast-in {
      from {
        transform: translateY(-8px);
        opacity: 0;
      }
    }
  `,
})
export class ToastOutletComponent {
  protected readonly toast = inject(ToastService);
}
