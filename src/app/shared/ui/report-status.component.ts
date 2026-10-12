import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { DailySummaryStatus } from '../../core/models/domain.models';
import { IconComponent, type IconName } from './icon.component';

const STYLE: Readonly<Record<DailySummaryStatus, { readonly cls: string; readonly icon: IconName }>> = {
  DRAFT: { cls: 'bg-stock text-ink', icon: 'note' },
  SUBMITTED: { cls: 'bg-charcoal text-white', icon: 'clock' },
  APPROVED: { cls: 'bg-done text-white', icon: 'check' },
  RETURNED: { cls: 'bg-hold text-white', icon: 'retry' },
};

/** Daily-report state as the same punched tag the work orders wear: fill, glyph and word. */
@Component({
  selector: 'aon-report-status',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', '[class.tag-outline]': "status() === 'DRAFT'" },
  template: `
    <span class="tag-sm tag-shape-sm inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap py-1 pr-2.5 label-caps leading-none" [class]="style().cls">
      <span class="tag-eyelet"></span>
      <aon-icon [name]="style().icon" [size]="14" [stroke]="3" />{{ i18n.t(key()) }}
    </span>
  `,
})
export class ReportStatusComponent {
  protected readonly i18n = inject(I18nService);
  readonly status = input.required<DailySummaryStatus>();
  protected readonly style = computed(() => STYLE[this.status()]);
  protected readonly key = computed(() => `reports.status${this.status()}` as const);
}
