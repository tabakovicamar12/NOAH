import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ConsentService } from '../../core/auth/consent.service';
import { homeFor } from '../../core/auth/guards';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { CONSENT_VERSION } from '../../core/models/domain.models';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { LogoComponent } from '../../shared/ui/logo.component';

/**
 * First-login privacy notice (GDPR Art. 13). Work records rest on law and contract, so the worker
 * acknowledges the notice rather than consenting.
 */
@Component({
  selector: 'aon-consent',
  imports: [RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-dvh bg-[var(--color-rail)]">
      <dialog
        #dialog
        class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border-0 bg-white p-0 text-ink backdrop:bg-[var(--color-rail)]"
        aria-labelledby="consent-title"
        (cancel)="$event.preventDefault()"
      >
        <header class="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
          <aon-logo [size]="1.2" />
          <span class="text-sm text-ink-muted">{{ i18n.t('consent.version', { v: version }) }}</span>
        </header>
        <div class="px-5 pb-6 pt-5 sm:px-6">
          <h1 id="consent-title" class="text-[clamp(1.35rem,1.2rem+0.6vw,1.65rem)] font-semibold leading-tight tracking-tight">{{ i18n.t('consent.title') }}</h1>
          <p class="mt-2 leading-relaxed text-ink-muted">{{ i18n.t('consent.intro') }}</p>
          <ul class="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            @for (p of points; track p.key) {
              <li class="flex gap-3 py-3">
                <aon-icon [name]="p.icon" [size]="18" class="mt-0.5 shrink-0 text-gold" />
                <p class="text-[0.95rem] leading-snug">{{ i18n.t(p.key) }}</p>
              </li>
            }
          </ul>
          <a routerLink="/privacy" class="mt-3 inline-flex min-h-11 items-center gap-2 font-medium underline decoration-[var(--color-line-strong)] underline-offset-4">
            <aon-icon name="file" [size]="16" />{{ i18n.t('login.privacyLink') }}
          </a>
          <div class="mt-4 grid gap-2">
            <button
              type="button"
              class="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-gold px-5 font-semibold text-charcoal disabled:opacity-60"
              [disabled]="busy()"
              (click)="accept()"
            >
              <aon-icon name="check" [size]="18" [stroke]="2.25" />
              {{ i18n.t('consent.accept') }}
            </button>
            <button type="button" class="min-h-12 rounded-lg border border-[var(--color-line-strong)] px-5 font-medium" [disabled]="busy()" (click)="decline()">
              {{ i18n.t('consent.decline') }}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  `,
})
export class ConsentComponent {
  protected readonly i18n = inject(I18nService);
  private readonly consent = inject(ConsentService);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly version = CONSENT_VERSION;
  protected readonly busy = signal(false);
  protected readonly points: ReadonlyArray<{ key: TranslationKey; icon: IconName }> = [
    { key: 'consent.p1', icon: 'clock' },
    { key: 'consent.p2', icon: 'clipboard' },
    { key: 'consent.p3', icon: 'camera' },
    { key: 'consent.p5', icon: 'shield' },
  ];

  constructor() {
    afterNextRender(() => {
      try {
        this.dialog().nativeElement.showModal();
      } catch {
        this.dialog().nativeElement.setAttribute('open', '');
      }
    });
  }

  protected async accept(): Promise<void> {
    const user = this.session.user();
    if (!user || this.busy()) return;
    this.busy.set(true);
    try {
      await this.consent.accept(user.id);
      this.dialog().nativeElement.close();
      await this.router.navigateByUrl(homeFor(user.role));
    } catch (err: unknown) {
      console.error('[AON] consent save failed', err);
      this.toast.error(this.i18n.t('common.errorGeneric'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async decline(): Promise<void> {
    this.dialog().nativeElement.close();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
