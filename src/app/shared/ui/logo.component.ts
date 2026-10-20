import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The AON · NOAH wordmark, as on the office rail: Inter 500, NOAH in gold. */
@Component({
  selector: 'aon-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-baseline gap-[0.35em] leading-none', '[style.font-size.rem]': 'size()' },
  template: `
    <span class="font-medium tracking-[0.01em]">AON</span>
    <span class="opacity-50" aria-hidden="true">·</span>
    <span class="font-medium tracking-[0.01em] text-gold">NOAH</span>
    @if (sub()) {
      <span class="ml-1 text-[0.55em] opacity-70">{{ sub() }}</span>
    }
  `,
})
export class LogoComponent {
  readonly size = input<number>(1.45);
  readonly sub = input<string>('');
}
