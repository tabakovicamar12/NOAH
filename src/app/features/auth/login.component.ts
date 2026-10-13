import { DEMO_MODE } from '../../core/ui/demo-mode';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ConsentService } from '../../core/auth/consent.service';
import { homeFor } from '../../core/auth/guards';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { Role } from '../../core/models/domain.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { LogoComponent } from '../../shared/ui/logo.component';
import { NetworkStatusComponent } from '../../shared/ui/network-status.component';
import { StatusTagComponent } from '../../shared/ui/status-tag.component';

@Component({
  selector: 'aon-login',
  imports: [FormsModule, RouterLink, IconComponent, LanguageSwitchComponent, LogoComponent, NetworkStatusComponent, StatusTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <!-- Brand panel -->
      <section class="relative flex flex-col bg-charcoal px-4 pb-8 pt-[calc(env(safe-area-inset-top)+1rem)] text-white sm:px-8 lg:px-12 lg:pb-12 lg:pt-10">
        <div class="flex items-center justify-between gap-3">
          <aon-logo [size]="2" />
          <div class="flex items-center gap-2">
            <aon-network-status [onDark]="true" />
            <aon-language-switch [onDark]="true" />
          </div>
        </div>
        <div class="mt-8 lg:mt-auto">
          <h1 class="font-cond-tight text-[3.25rem] leading-[0.92] sm:text-6xl lg:text-[5.5rem]">{{ i18n.t('app.tagline') }}</h1>
          <p class="mt-4 max-w-md text-lg text-on-dark-muted">{{ i18n.t('shift.noGps') }}</p>
          <ul class="mt-8 hidden flex-wrap gap-3 lg:flex" aria-hidden="true">
            <li><aon-status-tag status="NEW" /></li>
            <li><aon-status-tag status="IN_PROGRESS" /></li>
            <li><aon-status-tag status="COMPLETED" /></li>
            <li><aon-status-tag status="ISSUE" /></li>
          </ul>
        </div>
      </section>

      <!-- Form -->
      <main class="flex items-start justify-center px-4 py-8 sm:px-8 lg:items-center lg:py-12">
        <form class="w-full max-w-md" novalidate (ngSubmit)="submit()" aria-labelledby="login-title">
          <h2 id="login-title" class="font-cond text-4xl">{{ i18n.t('login.title') }}</h2>

          <fieldset class="mt-6">
            <legend class="label-caps text-ink-muted">{{ i18n.t('login.roleQuestion') }}</legend>
            <div class="mt-2 grid grid-cols-2 gap-2">
              @for (r of roles; track r.value) {
                <label
                  class="flex min-h-20 cursor-pointer flex-col justify-center gap-1 border-2 px-4 py-3 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink"
                  [class]="role() === r.value ? 'border-charcoal bg-charcoal text-white' : 'border-charcoal bg-stock text-ink'"
                >
                  <input type="radio" name="role" class="sr-only" [value]="r.value" [ngModel]="role()" (ngModelChange)="role.set($event)" />
                  <aon-icon [name]="r.icon" [size]="26" [class]="role() === r.value ? 'text-gold' : ''" />
                  <span class="font-cond text-xl leading-tight">{{ i18n.t(r.label) }}</span>
                </label>
              }
            </div>
          </fieldset>

          <label class="mt-6 block">
            <span class="label-caps text-ink-muted">{{ i18n.t('login.username') }}</span>
            <input
              name="username"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              class="mt-1.5 block min-h-14 w-full border-2 border-charcoal bg-stock px-4 text-lg font-semibold outline-none focus:border-ink focus:ring-4 focus:ring-gold"
              [ngModel]="username()"
              (ngModelChange)="username.set($event)"
            />
          </label>
          <label class="mt-4 block">
            <span class="label-caps text-ink-muted">{{ i18n.t('login.password') }}</span>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              class="mt-1.5 block min-h-14 w-full border-2 border-charcoal bg-stock px-4 text-lg font-semibold outline-none focus:border-ink focus:ring-4 focus:ring-gold"
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
            />
          </label>

          <label class="mt-6 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="consent"
              class="aon-check mt-0.5"
              [ngModel]="consent()"
              (ngModelChange)="consent.set($event)"
            />
            <span class="text-[0.95rem] leading-snug">
              {{ i18n.t('login.consent') }}
              <a routerLink="/privacy" class="font-bold text-ink underline">{{ i18n.t('login.privacyLink') }}</a>
            </span>
          </label>

          @if (error()) {
            <p class="mt-5 flex items-start gap-2 border-2 border-hold bg-hold-pale px-4 py-3 font-semibold text-hold-ink" role="alert">
              <aon-icon name="alert" [size]="22" />
              {{ error() }}
            </p>
          }

          <button
            type="submit"
            class="mt-6 flex min-h-16 w-full items-center justify-between bg-gold px-6 font-cond text-2xl text-ink transition-transform active:scale-[0.99] disabled:opacity-60"
            [disabled]="busy()"
          >
            {{ busy() ? i18n.t('login.submitting') : i18n.t('login.submit') }}
            <aon-icon name="chevron-right" [size]="28" [stroke]="2.75" />
          </button>

          @if (demo) {
            <aside class="mt-8 border-2 border-dashed border-charcoal px-4 py-3 text-sm">
              <p class="label-caps">{{ i18n.t('login.demoTitle') }} · {{ i18n.t('common.demo') }}</p>
              <p class="mt-1 font-semibold">{{ i18n.t('login.demoWorker') }}</p>
              <p class="font-semibold">{{ i18n.t('login.demoManager') }}</p>
            </aside>
          }
        </form>
      </main>
    </div>
  `,
})
export class LoginComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly demo = DEMO_MODE;
  private readonly auth = inject(AuthService);
  private readonly consentService = inject(ConsentService);
  private readonly network = inject(NetworkStatusService);
  private readonly router = inject(Router);

  protected readonly roles: ReadonlyArray<{ value: Role; label: TranslationKey; icon: 'users' | 'clipboard' }> = [
    { value: 'WORKER', label: 'login.roleWorker', icon: 'users' },
    { value: 'MANAGER', label: 'login.roleManager', icon: 'clipboard' },
  ];

  protected readonly role = signal<Role>('WORKER');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly consent = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    if (!this.username().trim() || !this.password()) {
      this.error.set(this.i18n.t('login.errRequired'));
      return;
    }
    if (!this.consent()) {
      this.error.set(this.i18n.t('login.errConsent'));
      return;
    }
    if (!this.network.online()) {
      this.error.set(this.i18n.t('login.errOffline'));
      return;
    }
    this.busy.set(true);
    try {
      const outcome = await this.auth.login(this.username(), this.password(), this.role());
      if (!outcome.ok) {
        const roleName = this.i18n.t(this.role() === 'WORKER' ? 'login.roleWorker' : 'login.roleManager');
        const messages: Record<typeof outcome.reason, string> = {
          INVALID: this.i18n.t('login.errInvalid'),
          ROLE_MISMATCH: this.i18n.t('login.errRole', { role: roleName }),
          OFFLINE: this.i18n.t('login.errOffline'),
          THROTTLED: this.i18n.t('login.errThrottled'),
          UNKNOWN: this.i18n.t('common.errorGeneric'),
        };
        this.error.set(messages[outcome.reason]);
        return;
      }
      this.consentService.preAccepted.set(true);
      const hasConsent = await this.consentService.hasConsent(outcome.user.id);
      await this.router.navigateByUrl(hasConsent ? homeFor(outcome.user.role) : '/consent');
    } catch (err: unknown) {
      console.error('[AON] login flow failed', err);
      this.error.set(this.i18n.t('common.errorGeneric'));
    } finally {
      this.busy.set(false);
    }
  }
}
