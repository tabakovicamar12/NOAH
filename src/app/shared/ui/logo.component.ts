import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** AON wordmark set in condensed Archivo with the NOAH gold eyelet. */
@Component({
  selector: 'aon-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2' },
  template: `
    <span class="relative inline-block size-3 rounded-full bg-gold ring-[3px] ring-inset ring-charcoal-deep" aria-hidden="true"></span>
    <span class="font-cond-tight leading-none tracking-[0.08em]" [style.font-size.rem]="size()">AON</span>
    @if (sub()) {
      <span class="label-caps ml-1 leading-none opacity-80">{{ sub() }}</span>
    }
  `,
})
export class LogoComponent {
  readonly size = input<number>(1.75);
  readonly sub = input<string>('');
}
