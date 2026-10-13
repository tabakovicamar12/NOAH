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
 * acknowledges the notice rather than consenting; optional voice input asks for its own consent.
 */
@Component({
  selector: 'aon-consent',
  imports: [RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-dvh bg-charcoal">
      <dialog
        #dialog
        class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto border-0 bg-stock p-0 text-ink backdrop:bg-charcoal"
        aria-labelledby="consent-title"
        (cancel)="$event.preventDefault()"
      >
        <header class="flex items-center justify-between bg-charcoal px-5 py-4 text-white sm:px-6">
          <aon-logo [size]="1.5" />
          <span class="label-caps text-on-dark-muted">{{ i18n.t('consent.version', { v: version }) }}</span>
        </header>
        <div class="px-5 pb-6 pt-5 sm:px-6">
          <h1 id="consent-title" class="font-cond text-[2.25rem] leading-tight">{{ i18n.t('consent.title') }}</h1>
          <p class="mt-2 text-lg">{{ i18n.t('consent.intro') }}</p>
          <ul class="mt-5 divide-y-2 divide-ground-deep border-y-2 border-charcoal">
            @for (p of points; track p.key) {
              <li class="flex gap-3 py-3.5">
                <aon-icon [name]="p.icon" [size]="24" class="mt-0.5 text-gold-ink" />
                <p class="leading-snug">{{ i18n.t(p.key) }}</p>
              </li>
            }
          </ul>
          <a routerLink="/privacy" class="mt-4 inline-flex min-h-12 items-center gap-2 font-bold underline">
            <aon-icon name="file" [size]="20" />{{ i18n.t('login.privacyLink') }}
          </a>
          <div class="mt-5 grid gap-3">
            <button
              type="button"
              class="flex min-h-16 items-center justify-between bg-gold px-6 font-cond text-2xl text-ink disabled:opacity-60"
              [disabled]="busy()"
              (click)="accept()"
            >
              {{ i18n.t('consent.accept') }}
              <aon-icon name="check" [size]="28" [stroke]="3" />
            </button>
            <button type="button" class="min-h-14 border-2 border-charcoal px-6 font-cond text-lg" [disabled]="busy()" (click)="decline()">
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
    { key: 'consent.p4', icon: 'mic' },
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
