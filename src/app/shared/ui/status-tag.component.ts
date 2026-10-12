import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { WorkOrderStatus } from '../../core/models/domain.models';
import { IconComponent, type IconName } from './icon.component';

const STYLE: Readonly<Record<WorkOrderStatus, { readonly cls: string; readonly icon: IconName }>> = {
  NEW: { cls: 'bg-stock text-ink', icon: 'plus' },
  IN_PROGRESS: { cls: 'bg-gold text-ink', icon: 'play' },
  COMPLETED: { cls: 'bg-done text-white', icon: 'check' },
  ISSUE: { cls: 'bg-hold text-white', icon: 'alert' },
};

/**
 * The inspection tag: work-order status as a punched tag.
 * Status is always carried three ways: fill, glyph and word, so it reads in glare and in greyscale.
 */
@Component({
  selector: 'aon-status-tag',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex', '[class.tag-outline]': "status() === 'NEW'" },
  template: `
    <span
      class="tag-sm tag-shape-sm inline-flex items-center gap-1.5 whitespace-nowrap py-1 pr-2.5 label-caps leading-none"
      [class]="style().cls"
      [class.min-h-8]="size() === 'md'"
      [class.min-h-7]="size() === 'sm'"
    >
      <span class="tag-eyelet"></span>
      <aon-icon [name]="style().icon" [size]="14" [stroke]="3" />
      {{ i18n.t(statusKey()) }}
    </span>
  `,
})
export class StatusTagComponent {
  protected readonly i18n = inject(I18nService);
  readonly status = input.required<WorkOrderStatus>();
  readonly size = input<'sm' | 'md'>('md');
  protected readonly style = computed(() => STYLE[this.status()]);
  protected readonly statusKey = computed(() => `status.${this.status()}` as const);
}
