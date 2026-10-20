import { DEMO_MODE } from '../../core/ui/demo-mode';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ConsentService } from '../../core/auth/consent.service';
import { homeFor } from '../../core/auth/guards';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import type { LoginSide } from '../../core/models/api.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { ClockService } from '../../core/ui/clock.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { LanguageSwitchComponent } from '../../shared/ui/language-switch.component';
import { NetworkStatusComponent } from '../../shared/ui/network-status.component';

@Component({
  selector: 'aon-login',
  imports: [FormsModule, RouterLink, IconComponent, LanguageSwitchComponent, NetworkStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mgr-ui' },
  template: `
    <div class="shell">
      <!-- Brand: the same charcoal rail the office uses, with the promise in one line -->
      <section class="brand" aria-labelledby="brand-title">
        <p class="mark"><span>AON</span><span class="dot" aria-hidden="true">·</span><span class="noah">NOAH</span></p>
        <div class="pitch ph">
          <img class="ph-img" src="/plates/login-concrete.jpg" alt="" width="1200" height="1607" decoding="async" />
          <span class="ph-shade" aria-hidden="true"></span>
          <!-- Same clock, tidier: the seconds row spans the digits exactly, dots ease in, the colon breathes. -->
          <div class="ph-copy tk3 tq">
            <h1 id="brand-title" class="sr-only">{{ i18n.t('app.tagline') }}</h1>
            <div class="tq-stack">
            <div class="tk3-matrix" role="timer" [attr.aria-label]="i18n.time(clock.now())">
              @for (g of matrix(); track $index) {
                @if (g === ':') {
                  <span class="tk3-colon"><i></i><i></i></span>
                } @else {
                  <span class="tk3-digit">
                    @for (on of g; track $index) {
                      <i [class.is-on]="on"></i>
                    }
                  </span>
                }
              }
            </div>
            <div class="tq-seconds" aria-hidden="true">
              @for (on of secondDots(); track $index) {
                <i [class.is-on]="on"></i>
              }
            </div>
            </div>
            <p class="tq-date dv3">
              <span class="dv3-week" aria-hidden="true">
                @for (d of weekLetters(); track $index) {
                  <span [class.is-today]="$index === weekIdx()" [class.is-past]="$index < weekIdx()"><i></i>{{ d }}</span>
                }
              </span>
            </p>
          </div>
        </div>
      </section>

      <!-- One centred column: status and language above the card, demo accounts inside its foot. -->
      <main class="side">
        <div class="lv-col">
          <div class="lv-tools">
            <aon-network-status variant="line" [onDark]="false" />
            <aon-language-switch />
          </div>
          <form class="card lv-card" novalidate (ngSubmit)="submit()" aria-labelledby="login-title">
            <h2 id="login-title" class="title">{{ i18n.t('login.title') }}</h2>
            <fieldset class="mt-5">
              <legend class="label">{{ i18n.t('login.roleQuestion') }}</legend>
              <div class="seg">
                @for (r of roles; track r.value) {
                  <label class="seg-opt" [class.is-on]="role() === r.value">
                    <input type="radio" name="role" class="sr-only" [value]="r.value" [ngModel]="role()" (ngModelChange)="role.set($event)" />
                    <aon-icon [name]="r.icon" [size]="18" [stroke]="2" />
                    <span>{{ i18n.t(r.label) }}</span>
                  </label>
                }
              </div>
            </fieldset>

            <label class="mt-4 block">
              <span class="label">{{ i18n.t('login.username') }}</span>
              <input
                name="username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                class="field"
                [ngModel]="username()"
                (ngModelChange)="username.set($event)"
              />
            </label>
            <label class="mt-3.5 block">
              <span class="label">{{ i18n.t('login.password') }}</span>
              <input
                name="password"
                type="password"
                autocomplete="current-password"
                class="field"
                [ngModel]="password()"
                (ngModelChange)="password.set($event)"
              />
            </label>

            <!-- The notice itself is acknowledged once per account and notice version, after the first login. -->
            <p class="consent">
              <a routerLink="/privacy">{{ i18n.t('login.privacyLink') }}</a>
            </p>

            @if (error()) {
              <p class="alert" role="alert"><aon-icon name="alert" [size]="18" />{{ error() }}</p>
            }

            <button type="submit" class="submit" [disabled]="busy()">
              {{ busy() ? i18n.t('login.submitting') : i18n.t('login.submit') }}
              <aon-icon name="arrow-right" [size]="18" [stroke]="2.25" />
            </button>
            @if (demo) {
              <aside class="lv-demo" [attr.aria-label]="i18n.t('login.demoTitle')">
                <p class="demo-title">{{ i18n.t('login.demoTitle') }} · {{ i18n.t('common.demo') }}</p>
                <div class="demo-row">
                  <button type="button" class="demo-btn" (click)="fillDemo('WORKER')">
                    <aon-icon name="users" [size]="16" [stroke]="2" />
                    <span><b>{{ i18n.t('login.roleWorker') }}</b><small>delavec / delavec</small></span>
                  </button>
                  <button type="button" class="demo-btn" (click)="fillDemo('MANAGER')">
                    <aon-icon name="clipboard" [size]="16" [stroke]="2" />
                    <span><b>{{ i18n.t('login.roleManager') }}</b><small>vodja / vodja</small></span>
                  </button>
                </div>
              </aside>
            }
          </form>
        </div>
      </main>

    </div>
  `,
  styles: `
    :host {
      display: block;
      background: var(--color-site);
      color: var(--color-text);
      font-family: var(--font-ui);
      font-variant-numeric: normal;
    }
    .shell {
      display: grid;
      min-height: 100dvh;
      grid-template-columns: minmax(0, 1fr);
    }
    @media (min-width: 1024px) {
      .shell {
        grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
      }
    }

    /* Brand panel */
    .brand {
      display: flex;
      flex-direction: column;
      padding: calc(env(safe-area-inset-top) + 1.1rem) 1.25rem 1.4rem;
      background: var(--color-rail);
      color: var(--color-rail-text);
    }
    @media (min-width: 1024px) {
      .brand {
        padding: 2.25rem clamp(2rem, 4vw, 4rem) 3rem;
      }
    }
    .mark {
      display: flex;
      gap: 0.4rem;
      font-size: 1.45rem;
      font-weight: 500;
      letter-spacing: 0.01em;
      line-height: 1;
    }
    .mark .dot {
      color: var(--color-rail-muted);
    }
    .mark .noah {
      color: var(--color-gold);
    }
    .pitch {
      margin-top: 1.1rem;
    }
    @media (min-width: 1024px) {
      .pitch {
        margin-top: auto;
        max-width: 30rem;
      }
    }

    .card {
      width: 100%;
      max-width: 26rem;
      padding: 1.4rem 1.25rem 1.5rem;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 8px 24px -18px rgb(20 20 20 / 0.25);
    }
    @media (min-width: 640px) {
      .card {
        padding: 1.9rem 2rem 2rem;
      }
    }
    .title {
      font-size: clamp(1.35rem, 1.2rem + 0.5vw, 1.65rem);
      font-weight: 600;
      letter-spacing: -0.015em;
      line-height: 1.2;
    }
    .label {
      display: block;
      margin-bottom: 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    .seg {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.2rem;
      padding: 0.2rem;
      border-radius: 0.6rem;
      background: var(--color-field);
    }
    .seg-opt {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      min-height: 2.75rem;
      padding: 0 0.5rem;
      border-radius: 0.45rem;
      color: var(--color-text-muted);
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 160ms var(--ease-out-expo), color 160ms var(--ease-out-expo);
    }
    .seg-opt.is-on {
      background: var(--color-panel);
      color: var(--color-text);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12);
    }
    .seg-opt.is-on aon-icon {
      color: var(--color-gold);
    }
    .seg-opt:has(:focus-visible) {
      outline: 2px solid var(--color-charcoal);
      outline-offset: 1px;
    }
    .field {
      display: block;
      width: 100%;
      min-height: 2.85rem;
      padding: 0 0.8rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: #fff;
      color: var(--color-text);
      font-size: 1rem;
      outline: none;
      transition: border-color 160ms var(--ease-out-expo), box-shadow 160ms var(--ease-out-expo);
    }
    .field:focus-visible {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25);
    }
    .consent {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      margin-top: 1.1rem;
      font-size: 0.93rem;
      line-height: 1.45;
    }
    .consent a {
      color: var(--color-text);
      font-weight: 600;
      text-decoration: underline;
      text-decoration-color: var(--color-line-strong);
      text-underline-offset: 0.2em;
    }
    .alert {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin-top: 1rem;
      padding: 0.65rem 0.8rem;
      border: 1px solid #ef9a9a;
      border-radius: 0.5rem;
      background: #fdeced;
      color: var(--color-bad-ink);
      font-size: 0.93rem;
      line-height: 1.4;
    }
    .alert aon-icon {
      flex: 0 0 auto;
      margin-top: 0.1rem;
    }
    .submit {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-height: 2.9rem;
      margin-top: 1.25rem;
      border-radius: 0.5rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-size: 1rem;
      font-weight: 600;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12), inset 0 -2px 0 rgb(0 0 0 / 0.08);
      transition: filter 160ms var(--ease-out-expo), transform 120ms var(--ease-out-expo);
    }
    .submit:hover:not(:disabled) {
      filter: brightness(1.04);
    }
    .submit:active:not(:disabled) {
      transform: translateY(1px);
      box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.15);
    }
    .submit:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .submit:focus-visible {
      outline: 2px solid var(--color-charcoal);
      outline-offset: 2px;
    }
    .demo-title {
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .demo-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      margin-top: 0.4rem;
    }
    .demo-btn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 3.1rem;
      padding: 0.35rem 0.7rem;
      border: 1px dashed var(--color-line-strong);
      border-radius: 0.5rem;
      color: var(--color-text);
      font-size: 0.875rem;
      text-align: left;
    }
    .demo-btn:hover {
      border-style: solid;
      background: var(--color-panel);
    }
    .demo-btn b {
      display: block;
      font-weight: 600;
      line-height: 1.25;
    }
    .demo-btn small {
      display: block;
      color: var(--color-text-muted);
      font-size: 0.8rem;
      line-height: 1.3;
    }
    .demo-btn aon-icon {
      flex: 0 0 auto;
      color: var(--color-text-muted);
    }
    @media (max-width: 420px) {
      .seg-opt aon-icon {
        display: none;
      }
    }
    /* ---- Brand photograph (variants) ---- */
    /* The photo fills the whole brand panel; the panel is its positioning context. */
    .brand {
      position: relative;
      isolation: isolate;
      overflow: hidden;
    }
    .brand .mark {
      position: relative;
      z-index: 2;
    }
    .ph-img {
      position: absolute;
      inset: 0;
      z-index: -2;
      width: 100%;
      height: 100%;
      object-fit: cover;
      animation: ph-in 900ms var(--ease-out-expo) both;
    }
    .ph-shade {
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
    }
    .ph-copy {
      position: relative;
      z-index: 1;
    }
    /* Phone: the photo sits behind the compact band, darkened for the text. */
    .ph .ph-shade {
      background: linear-gradient(to bottom, rgb(30 29 28 / 0.55), rgb(30 29 28 / 0.88));
    }
    @media (min-width: 1024px) {
      /* Concrete with lit tie holes under a quiet charcoal veil; the dot clock sits on the dark foot. */
      .ph .ph-shade {
        background: linear-gradient(to top, rgb(24 23 22 / 0.9) 0%, rgb(24 23 22 / 0.35) 45%, rgb(24 23 22 / 0.2) 100%);
      }
    }
    @keyframes ph-in {
      from {
        opacity: 0;
        transform: scale(1.03);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ph-img {
        animation: none;
      }
    }
    /* ---- The time, set in dots, on the brand panel ---- */
    .tk3-matrix {
      display: flex;
      align-items: center;
      gap: clamp(0.5rem, 0.9vw, 0.9rem);
    }
    .tk3-digit {
      display: grid;
      grid-template-columns: repeat(5, var(--tk3-d));
      gap: calc(var(--tk3-d) * 0.35);
      --tk3-d: clamp(0.42rem, 0.25rem + 0.6vw, 0.78rem);
    }
    .tk3-digit i,
    .tk3-colon i {
      display: block;
      width: var(--tk3-d, 0.6rem);
      height: var(--tk3-d, 0.6rem);
      border-radius: 9999px;
      background: rgb(255 255 255 / 0.1);
    }
    .tk3-digit i.is-on {
      background: var(--color-gold);
      box-shadow: 0 0 10px rgb(193 160 80 / 0.45);
    }
    .tk3-colon {
      display: grid;
      gap: calc(var(--tk3-d) * 2);
      --tk3-d: clamp(0.42rem, 0.25rem + 0.6vw, 0.78rem);
    }
    .tk3-colon i {
      background: rgb(255 255 255 / 0.75);
    }
    @media (max-width: 1023px) {
    }
    /* ---- Dot clock: easing, the seconds row and the date line ---- */
    .tq .tk3-digit i,
    .tq .tk3-colon i,
    .tq .tq-seconds i {
      transition: background-color 380ms var(--ease-out-expo), box-shadow 380ms var(--ease-out-expo);
    }
    .tq .tk3-digit i.is-on {
      box-shadow: 0 0 8px rgb(193 160 80 / 0.35);
    }
    .tq .tk3-colon i {
      background: var(--color-gold);
      animation: tq-breathe 2s ease-in-out infinite;
    }
    .tq-stack {
      display: inline-grid;
      gap: 1rem;
    }
    .tq-seconds {
      display: flex;
      justify-content: space-between;
    }
    .tq-seconds i {
      display: block;
      width: 0.3rem;
      height: 0.3rem;
      border-radius: 9999px;
      background: rgb(255 255 255 / 0.12);
    }
    .tq-seconds i.is-on {
      background: rgb(193 160 80 / 0.85);
    }
    .tq-date {
      margin-top: 0.9rem;
      color: rgb(236 235 231 / 0.72);
      font-size: clamp(0.95rem, 0.9rem + 0.3vw, 1.1rem);
    }
    .tq-date b {
      color: #fff;
      font-weight: 600;
    }
    /* ---- Date line: the week as seven dots, today in gold ---- */
    .dv3 {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1.1rem;
    }
    .dv3-week {
      display: flex;
      gap: 0.45rem;
    }
    .dv3-week > span {
      display: grid;
      justify-items: center;
      gap: 0.25rem;
      color: rgb(236 235 231 / 0.45);
      font-size: 0.7rem;
      font-weight: 600;
    }
    .dv3-week i {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 9999px;
      background: rgb(255 255 255 / 0.12);
    }
    .dv3-week .is-past i {
      background: rgb(193 160 80 / 0.45);
    }
    .dv3-week .is-today {
      color: var(--color-gold);
    }
    .dv3-week .is-today i {
      background: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25);
    }
    @keyframes tq-breathe {
      50% {
        opacity: 0.35;
      }
    }
    @media (max-width: 1023px) {
      .tq-seconds {
        display: none;
      }
      .tq-stack {
        gap: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tq .tk3-colon i {
        animation: none;
      }
      .tq .tk3-digit i,
      .tq .tq-seconds i {
        transition: none;
      }
    }
    /* ---- Form side: one centred column ---- */
    .side {
      display: grid;
      place-items: center;
      min-height: 100%;
      padding: clamp(1rem, 3vw, 2rem) clamp(1rem, 4vw, 3rem);
    }
    @media (min-width: 1024px) {
      .side {
        min-height: 100dvh;
      }
    }
    .lv-col {
      display: grid;
      gap: 0.9rem;
      width: 100%;
      max-width: 27rem;
    }
    .lv-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem 1rem;
    }
    .lv-card {
      max-width: none;
    }
    .lv-demo {
      margin-top: 1.25rem;
      padding-top: 1.1rem;
      border-top: 1px solid var(--color-line);
    }
    @media (max-width: 420px) {
      .lv-demo .demo-row {
        grid-template-columns: minmax(0, 1fr);
      }
      .lv-card {
        padding: 1.2rem 1rem 1.25rem;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .seg-opt,
      .field,
      .submit {
        transition: none;
      }
    }
  `,
})
export class LoginComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly clock = inject(ClockService);
  /** 5 x 7 dot glyphs for the matrix clock, rows concatenated. */
  private static readonly DOT_FONT: Readonly<Record<string, string>> = {
    '0': '01110100011001110101110011000101110',
    '1': '00100011000010000100001000010001110',
    '2': '01110100010000100010001000100011111',
    '3': '11110000010000101110000010000111110',
    '4': '00010001100101010010111110001000010',
    '5': '11111100001111000001000011000101110',
    '6': '00110010001000011110100011000101110',
    '7': '11111000010001000100010000100001000',
    '8': '01110100011000101110100011000101110',
    '9': '01110100011000101111000010001001100',
  };
  /** Monday-first index of today, for the week strip. */
  protected readonly weekIdx = computed(() => (new Date(this.clock.now()).getDay() + 6) % 7);
  protected readonly weekLetters = computed(() => [...this.i18n.t('login.weekLetters')]);
  protected readonly time = computed(() => {
    const d = new Date(this.clock.now());
    const pad = (n: number): string => String(n).padStart(2, '0');
    return { hh: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) };
  });
  /** HH:MM as dot glyphs; ':' stays a separator. */
  protected readonly matrix = computed<readonly (readonly boolean[] | ':')[]>(() => {
    const { hh, mm } = this.time();
    return [...`${hh}:${mm}`].map((ch) => (ch === ':' ? ':' : [...(LoginComponent.DOT_FONT[ch] ?? '')].map((b) => b === '1')));
  });
  /** Thirty dots for the minute, filling two seconds per dot. */
  protected readonly secondDots = computed(() => {
    const s = Number(this.time().ss);
    return Array.from({ length: 30 }, (_, i) => i < Math.floor(s / 2) + 1);
  });
  protected readonly demo = DEMO_MODE;
  private readonly auth = inject(AuthService);
  private readonly consentService = inject(ConsentService);
  private readonly network = inject(NetworkStatusService);
  private readonly router = inject(Router);

  protected readonly roles: ReadonlyArray<{ value: LoginSide; label: TranslationKey; icon: 'users' | 'clipboard' }> = [
    { value: 'WORKER', label: 'login.roleWorker', icon: 'users' },
    { value: 'MANAGER', label: 'login.roleManager', icon: 'clipboard' },
  ];


  protected readonly role = signal<LoginSide>('WORKER');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Demo only: the account cards fill the form, so a presenter never types credentials. */
  protected fillDemo(role: LoginSide): void {
    const name = role === 'WORKER' ? 'delavec' : 'vodja';
    this.role.set(role);
    this.username.set(name);
    this.password.set(name);
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    if (!this.username().trim() || !this.password()) {
      this.error.set(this.i18n.t('login.errRequired'));
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
