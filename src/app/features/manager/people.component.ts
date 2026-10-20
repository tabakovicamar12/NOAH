import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/http/api-client.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { ApiError, type AdminUser } from '../../core/models/api.models';
import { ROLES, type Role } from '../../core/models/domain.models';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { ManagerStore } from './data/manager-store.service';
import { avatarTone, initialsOf } from './person';

type RoleFilter = 'ALL' | Role;
type State = { readonly kind: 'LOADING' } | { readonly kind: 'ERROR' } | { readonly kind: 'READY'; readonly users: readonly AdminUser[] };

const USERNAME = /^[a-z0-9._-]{3,40}$/;

/** Server refusals, in the words the administrator needs to fix them. */
const ERROR_KEYS: Readonly<Record<string, TranslationKey>> = {
  USERNAME_TAKEN: 'people.errTaken',
  INVALID_USERNAME: 'people.errUsername',
  PASSWORD_TOO_SHORT: 'people.errPassword',
  SELF_LOCKOUT: 'people.errSelf',
  LAST_ADMIN: 'people.errLastAdmin',
  OPEN_ORDERS: 'people.errOpenOrders',
};

/** An easy-to-read starting password: no look-alike characters, 12 long. */
function startingPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

/**
 * Uporabniki (administrator only): every account, its role and what it leads. Accounts are never deleted,
 * only deactivated, so their records keep a name. Who leads which project or object is set in Projekti.
 */
@Component({
  selector: 'aon-manager-people',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <header class="pp-head">
        <div>
          <h1 class="pp-title">{{ i18n.t('people.title') }}</h1>
          @if (ready(); as r) {
            <p class="pp-sub">{{ i18n.t('people.subtitle', { n: activeCount(), m: r.users.length - activeCount() }) }}</p>
          }
        </div>
        <div class="pp-actions">
          <button type="button" class="pp-quiet" [disabled]="state().kind === 'LOADING'" (click)="load()" [attr.aria-label]="i18n.t('mgr.refresh')">
            <aon-icon name="refresh" [size]="16" [class.animate-spin]="state().kind === 'LOADING'" />
          </button>
          <button type="button" class="pp-gold" [disabled]="creating()" (click)="openCreate()">
            <aon-icon name="user-plus" [size]="17" />{{ i18n.t('people.new') }}
          </button>
        </div>
      </header>

      <details class="pp-roles">
        <summary><aon-icon name="chevron-right" [size]="15" class="pp-chev" />{{ i18n.t('people.rolesTitle') }}</summary>
        <dl>
          @for (r of roleOrder; track r) {
            <div>
              <dt>{{ i18n.t(roleKey(r)) }}</dt>
              <dd>{{ i18n.t(roleHelpKey(r)) }}</dd>
            </div>
          }
        </dl>
      </details>

      @if (creating()) {
        <form class="pp-panel" novalidate (submit)="$event.preventDefault(); create()" aria-labelledby="pp-new-title">
          <h2 id="pp-new-title" class="pp-panel-title">{{ i18n.t('people.newTitle') }}</h2>
          <div class="pp-grid">
            <label class="pp-field">
              <span>{{ i18n.t('people.name') }}</span>
              <input type="text" maxlength="80" autocomplete="off" [value]="fName()" (input)="fName.set($any($event.target).value)" />
            </label>
            <label class="pp-field">
              <span>{{ i18n.t('people.username') }}</span>
              <input type="text" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false" [value]="fUsername()" (input)="fUsername.set($any($event.target).value)" />
            </label>
            <label class="pp-field">
              <span>{{ i18n.t('people.crew') }}</span>
              <input type="text" maxlength="40" autocomplete="off" [placeholder]="i18n.t('people.crewPlaceholder')" [value]="fCrew()" (input)="fCrew.set($any($event.target).value)" />
            </label>
            <label class="pp-field">
              <span>{{ i18n.t('people.password') }}</span>
              <span class="pp-pass">
                <input type="text" maxlength="200" autocomplete="off" spellcheck="false" [value]="fPassword()" (input)="fPassword.set($any($event.target).value)" />
                <button type="button" class="pp-quiet" (click)="fPassword.set(newPassword())" [attr.aria-label]="i18n.t('people.generate')" [title]="i18n.t('people.generate')">
                  <aon-icon name="refresh" [size]="15" />
                </button>
              </span>
            </label>
          </div>
          <fieldset class="pp-rolepick">
            <legend>{{ i18n.t('people.role') }}</legend>
            @for (r of roleOrder; track r) {
              <label [class.is-on]="fRole() === r">
                <input type="radio" name="pp-new-role" class="sr-only" [checked]="fRole() === r" (change)="fRole.set(r)" />
                <span class="pp-rolename">{{ i18n.t(roleKey(r)) }}</span>
                <span class="pp-rolehelp">{{ i18n.t(roleHelpKey(r)) }}</span>
              </label>
            }
          </fieldset>
          <p class="pp-hint">{{ i18n.t('people.newHint') }}</p>
          @if (formError(); as err) {
            <p class="pp-error" role="alert"><aon-icon name="alert" [size]="17" />{{ err }}</p>
          }
          <div class="pp-foot">
            <button type="submit" class="pp-dark" [disabled]="saving()">{{ saving() ? i18n.t('projects.saving') : i18n.t('people.create') }}</button>
            <button type="button" class="pp-quiet" (click)="creating.set(false)">{{ i18n.t('common.cancel') }}</button>
          </div>
        </form>
      }

      @if (handoff(); as h) {
        <div class="pp-handoff" role="status">
          <aon-icon name="key" [size]="18" />
          <p>
            {{ i18n.t('people.handoff', { name: h.name }) }}
            <span class="pp-cred"><span>{{ i18n.t('people.username') }}</span><b>{{ h.username }}</b></span>
            <span class="pp-cred"><span>{{ i18n.t('people.password') }}</span><b>{{ h.password }}</b></span>
          </p>
          <button type="button" class="pp-quiet" (click)="handoff.set(null)">{{ i18n.t('common.close') }}</button>
        </div>
      }

      <div class="pp-tools">
        <div class="flt" role="group" [attr.aria-label]="i18n.t('people.role')">
          @for (f of filters(); track f.key) {
            <button type="button" class="flt-btn" [attr.aria-pressed]="filter() === f.key" (click)="filter.set(f.key)">{{ i18n.t(f.label) }}<span class="flt-n">{{ f.count }}</span></button>
          }
        </div>
        <label class="pp-search">
          <span class="sr-only">{{ i18n.t('people.search') }}</span>
          <aon-icon name="search" [size]="16" />
          <input type="search" [placeholder]="i18n.t('people.search')" [value]="query()" (input)="query.set($any($event.target).value)" />
        </label>
        <label class="pp-check">
          <input type="checkbox" class="aon-check" [checked]="showInactive()" (change)="showInactive.set($any($event.target).checked)" />
          <span>{{ i18n.t('people.showInactive') }}</span>
        </label>
      </div>

      @switch (state().kind) {
        @case ('LOADING') {
          <div class="pp-card" aria-busy="true">
            @for (i of [1, 2, 3, 4]; track i) {
              <div class="pp-skel"></div>
            }
            <span class="sr-only">{{ i18n.t('common.loading') }}</span>
          </div>
        }
        @case ('ERROR') {
          <p class="pp-error" role="alert">
            <aon-icon name="alert" [size]="17" />{{ i18n.t('people.loadFailed') }}
            <button type="button" class="pp-quiet" (click)="load()">{{ i18n.t('common.retry') }}</button>
          </p>
        }
        @default {
          <div class="pp-card">
            <div class="pp-row pp-th" aria-hidden="true">
              <span>{{ i18n.t('people.name') }}</span>
              <span>{{ i18n.t('people.role') }}</span>
              <span>{{ i18n.t('people.leads') }}</span>
              <span>{{ i18n.t('people.state') }}</span>
              <span></span>
            </div>
            <ul>
              @for (u of shown(); track u.id) {
                <li [class.is-off]="!u.active" [class.is-editing]="editId() === u.id">
                  <div class="pp-row">
                    <span class="pp-who">
                      <span class="ava" [attr.data-tone]="tone(u.displayName)" aria-hidden="true">{{ initials(u.displayName) }}</span>
                      <span class="min-w-0">
                        <span class="pp-name">{{ u.displayName }}@if (u.id === meId()) {<span class="pp-me">{{ i18n.t('people.you') }}</span>}</span>
                        <span class="pp-user">{{ u.username }}@if (u.crew) { · {{ u.crew }}}</span>
                      </span>
                    </span>
                    <span class="pp-role" [attr.data-role]="u.role">{{ i18n.t(roleKey(u.role)) }}</span>
                    <span class="pp-leads">{{ leads(u) }}</span>
                    <span class="pp-state" [class.is-off]="!u.active">
                      <span class="pp-dot" aria-hidden="true"></span>{{ i18n.t(u.active ? 'people.active' : 'people.inactive') }}
                    </span>
                    <span class="pp-act">
                      <button type="button" class="pp-quiet" [attr.aria-expanded]="editId() === u.id" (click)="toggleEdit(u)">
                        <aon-icon name="pencil" [size]="15" />{{ i18n.t('people.edit') }}
                      </button>
                    </span>
                  </div>

                  @if (editId() === u.id) {
                    <form class="pp-edit" novalidate (submit)="$event.preventDefault(); saveEdit(u)">
                      <div class="pp-grid pp-grid-2">
                        <label class="pp-field">
                          <span>{{ i18n.t('people.name') }}</span>
                          <input type="text" maxlength="80" autocomplete="off" [value]="eName()" (input)="eName.set($any($event.target).value)" />
                        </label>
                        <label class="pp-field">
                          <span>{{ i18n.t('people.crew') }}</span>
                          <input type="text" maxlength="40" autocomplete="off" [placeholder]="i18n.t('people.crewPlaceholder')" [value]="eCrew()" (input)="eCrew.set($any($event.target).value)" />
                        </label>
                      </div>
                      <fieldset class="pp-rolepick is-compact" [disabled]="u.id === meId()">
                        <legend>{{ i18n.t('people.role') }}</legend>
                        @for (r of roleOrder; track r) {
                          <label [class.is-on]="eRole() === r">
                            <input type="radio" [name]="'pp-role-' + u.id" class="sr-only" [checked]="eRole() === r" (change)="eRole.set(r)" />
                            <span class="pp-rolename">{{ i18n.t(roleKey(r)) }}</span>
                          </label>
                        }
                      </fieldset>
                      @if (u.id === meId()) {
                        <p class="pp-hint">{{ i18n.t('people.selfHint') }}</p>
                      } @else if (eRole() !== u.role && (u.role === 'MANAGER' || u.role === 'FOREMAN')) {
                        <p class="pp-hint">{{ i18n.t('people.roleChangeHint') }}</p>
                      }
                      @if (formError(); as err) {
                        <p class="pp-error" role="alert"><aon-icon name="alert" [size]="17" />{{ err }}</p>
                      }
                      <div class="pp-foot">
                        <button type="submit" class="pp-dark" [disabled]="saving()">{{ saving() ? i18n.t('projects.saving') : i18n.t('common.save') }}</button>
                        <button type="button" class="pp-quiet" (click)="editId.set(null)">{{ i18n.t('common.cancel') }}</button>
                      </div>

                      <div class="pp-more">
                        <div class="pp-pass-row">
                          <label class="pp-field">
                            <span>{{ i18n.t('people.newPassword') }}</span>
                            <span class="pp-pass">
                              <input type="text" maxlength="200" autocomplete="off" spellcheck="false" [value]="ePassword()" (input)="ePassword.set($any($event.target).value)" />
                              <button type="button" class="pp-quiet" (click)="ePassword.set(newPassword())" [attr.aria-label]="i18n.t('people.generate')" [title]="i18n.t('people.generate')">
                                <aon-icon name="refresh" [size]="15" />
                              </button>
                            </span>
                          </label>
                          <button type="button" class="pp-quiet" [disabled]="saving() || !ePassword()" (click)="resetPassword(u)">
                            <aon-icon name="key" [size]="15" />{{ i18n.t('people.setPassword') }}
                          </button>
                        </div>
                        @if (u.id !== meId()) {
                          @if (u.active) {
                            <button type="button" class="pp-bad" [disabled]="saving()" (click)="setActive(u, false)">
                              <aon-icon name="user-x" [size]="15" />{{ i18n.t(confirmOff() ? 'people.deactivateConfirm' : 'people.deactivate') }}
                            </button>
                          } @else {
                            <button type="button" class="pp-quiet" [disabled]="saving()" (click)="setActive(u, true)">
                              <aon-icon name="user-check" [size]="15" />{{ i18n.t('people.activate') }}
                            </button>
                          }
                        }
                      </div>
                      @if (confirmOff()) {
                        <p class="pp-hint">{{ i18n.t('people.deactivateHint', { n: u.openOrders }) }}</p>
                      }
                    </form>
                  }
                </li>
              } @empty {
                <li class="pp-empty">{{ i18n.t('mgr.noResults') }}</li>
              }
            </ul>
          </div>
          <p class="pp-note">{{ i18n.t('people.note') }}</p>
        }
      }
    </div>
  `,
  styles: `
    .pp-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem 1.5rem;
    }
    .pp-title {
      font-size: clamp(1.6rem, 1.3rem + 1.2vw, 2.09rem);
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .pp-sub {
      margin-top: 0.3rem;
      color: var(--color-text-muted);
    }
    .pp-actions,
    .pp-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .pp-foot {
      margin-top: 1rem;
    }
    .pp-quiet,
    .pp-gold,
    .pp-dark,
    .pp-bad {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      min-width: 2.6rem;
      min-height: 2.6rem;
      padding: 0 0.8rem;
      border-radius: 0.5rem;
      font-weight: 500;
      white-space: nowrap;
      transition: background-color 150ms ease-out;
    }
    .pp-quiet {
      border: 1px solid var(--color-line-strong);
      background: var(--color-panel);
      color: var(--color-text);
    }
    .pp-quiet:hover:not(:disabled) {
      background: var(--color-field);
    }
    .pp-gold {
      padding: 0 1rem;
      background: var(--color-gold);
      color: var(--color-charcoal);
      font-weight: 600;
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.12), inset 0 -2px 0 rgb(0 0 0 / 0.08);
    }
    .pp-gold:hover:not(:disabled) {
      filter: brightness(1.04);
    }
    .pp-dark {
      padding: 0 1.05rem;
      background: var(--color-rail);
      color: #fff;
      font-weight: 600;
    }
    .pp-dark:hover:not(:disabled) {
      background: var(--color-charcoal);
    }
    .pp-bad {
      color: var(--color-bad-ink);
    }
    .pp-bad:hover:not(:disabled) {
      background: var(--color-bad-tint);
    }
    button:disabled {
      opacity: 0.55;
    }

    /* Who can do what */
    .pp-roles {
      margin-top: 1rem;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
    }
    .pp-roles summary {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.9rem;
      padding: 0 1rem;
      font-weight: 500;
      cursor: pointer;
      list-style: none;
    }
    .pp-roles summary::-webkit-details-marker {
      display: none;
    }
    .pp-chev {
      color: var(--color-text-muted);
      transition: transform 180ms ease-out;
    }
    .pp-roles[open] .pp-chev {
      transform: rotate(90deg);
    }
    .pp-roles dl {
      display: grid;
      gap: 0.9rem 1.5rem;
      padding: 0.25rem 1rem 1rem 2.4rem;
    }
    @media (min-width: 900px) {
      .pp-roles dl {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    .pp-roles dt {
      font-weight: 600;
    }
    .pp-roles dd {
      margin-top: 0.2rem;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    /* Forms */
    .pp-panel {
      margin-top: 1rem;
      padding: 1.1rem 1.15rem 1.15rem;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 10px 26px -20px rgb(20 20 20 / 0.3);
    }
    .pp-panel-title {
      margin-bottom: 0.85rem;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .pp-grid {
      display: grid;
      gap: 0.75rem;
    }
    @media (min-width: 720px) {
      .pp-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (min-width: 1100px) {
      .pp-grid:not(.pp-grid-2) {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    .pp-field {
      display: grid;
      gap: 0.3rem;
      min-width: 0;
    }
    .pp-field > span:first-child {
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .pp-field input {
      width: 100%;
      min-width: 0;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: var(--color-panel);
      color: var(--color-text);
      font-weight: 500;
      outline: none;
      transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
    }
    .pp-field input:focus {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25);
    }
    .pp-pass {
      display: flex;
      gap: 0.4rem;
    }
    .pp-pass input {
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
    }
    .pp-rolepick {
      display: grid;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    @media (min-width: 900px) {
      .pp-rolepick {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    .pp-rolepick legend {
      margin-bottom: 0.35rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .pp-rolepick label {
      display: grid;
      gap: 0.2rem;
      padding: 0.7rem 0.85rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.6rem;
      cursor: pointer;
      transition: background-color 140ms ease-out, box-shadow 140ms ease-out;
    }
    .pp-rolepick label:hover {
      background: var(--color-row-tint);
    }
    .pp-rolepick label.is-on {
      border-color: transparent;
      background: var(--color-gold-fill);
      box-shadow: inset 0 0 0 2px var(--color-gold);
    }
    .pp-rolepick label:focus-within {
      outline: 2px solid var(--color-charcoal);
      outline-offset: 2px;
    }
    .pp-rolepick.is-compact {
      display: flex;
      flex-wrap: wrap;
    }
    .pp-rolepick.is-compact label {
      padding: 0.5rem 0.85rem;
    }
    .pp-rolepick:disabled label {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .pp-rolename {
      font-weight: 600;
    }
    .pp-rolehelp {
      color: var(--color-text-muted);
      font-size: 0.85rem;
      line-height: 1.4;
    }
    .pp-hint {
      margin-top: 0.6rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .pp-error {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.8rem;
      padding: 0.6rem 0.75rem;
      border-radius: 0.5rem;
      background: var(--color-bad-tint);
      color: var(--color-bad-ink);
      font-weight: 500;
    }
    .pp-handoff {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin-top: 1rem;
      padding: 0.85rem 1rem;
      border-radius: 0.75rem;
      background: var(--color-gold-fill);
      color: var(--color-gold-ink);
    }
    .pp-handoff p {
      flex: 1 1 18rem;
    }
    .pp-cred {
      display: inline-flex;
      gap: 0.35rem;
      margin-left: 0.75rem;
    }
    .pp-cred b {
      color: var(--color-text);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
    }

    /* Filters */
    .pp-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem 1rem;
      margin: 1.25rem 0 0.75rem;
    }
    .pp-search {
      display: flex;
      flex: 1 1 14rem;
      align-items: center;
      gap: 0.5rem;
      max-width: 22rem;
      min-height: 2.6rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-line-strong);
      border-radius: 0.5rem;
      background: var(--color-panel);
      color: var(--color-text-muted);
    }
    .pp-search:focus-within {
      border-color: var(--color-gold);
      box-shadow: 0 0 0 3px rgb(193 160 80 / 0.25);
    }
    .pp-search input {
      width: 100%;
      min-width: 0;
      border: 0;
      background: transparent;
      color: var(--color-text);
      outline: none;
    }
    .pp-check {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.6rem;
      cursor: pointer;
    }

    /* The list */
    .pp-card {
      overflow: hidden;
      border: 1px solid var(--color-line);
      border-radius: 0.75rem;
      background: var(--color-panel);
      box-shadow: 0 1px 2px rgb(20 20 20 / 0.04), 0 8px 24px -18px rgb(20 20 20 / 0.25);
    }
    .pp-skel {
      height: 4.35rem;
      border-top: 1px solid var(--color-line);
      background: linear-gradient(90deg, var(--color-row-tint), var(--color-track), var(--color-row-tint));
      background-size: 200% 100%;
      animation: pp-shimmer 1.4s ease-in-out infinite;
    }
    .pp-skel:first-child {
      border-top: 0;
    }
    @keyframes pp-shimmer {
      to {
        background-position: -200% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .pp-skel {
        animation: none;
      }
    }
    .pp-row {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) 8.5rem minmax(0, 1.5fr) 7.5rem 7rem;
      align-items: center;
      gap: 1rem;
      min-height: 4.35rem;
      padding: 0.6rem 1.1rem;
    }
    .pp-th {
      min-height: 2.6rem;
      border-bottom: 1px solid var(--color-line);
      background: var(--color-row-tint);
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }
    .pp-card li + li {
      border-top: 1px solid var(--color-line);
    }
    .pp-card li.is-editing {
      background: var(--color-row-tint);
    }
    .pp-card li.is-off .pp-who,
    .pp-card li.is-off .pp-leads {
      opacity: 0.6;
    }
    .pp-who {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 0;
    }
    .ava {
      display: grid;
      place-items: center;
      width: 2.15rem;
      height: 2.15rem;
      flex: 0 0 auto;
      border-radius: 9999px;
      background: #5d6f93;
      color: #fff;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .ava[data-tone='1'] {
      background: #b9984a;
    }
    .ava[data-tone='2'] {
      background: #a85a55;
    }
    .ava[data-tone='3'] {
      background: #4f7a72;
    }
    .ava[data-tone='4'] {
      background: #7b6a94;
    }
    .pp-name {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pp-me {
      padding: 0.05rem 0.45rem;
      border-radius: 9999px;
      background: var(--color-field);
      color: var(--color-text-muted);
      font-size: 0.78rem;
      font-weight: 500;
    }
    .pp-user {
      display: block;
      overflow: hidden;
      color: var(--color-text-muted);
      font-size: 0.875rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pp-role {
      justify-self: start;
      padding: 0.25rem 0.6rem;
      border-radius: 0.4rem;
      background: var(--color-new-tint);
      color: var(--color-new-ink);
      font-size: 0.875rem;
      font-weight: 500;
    }
    .pp-role[data-role='ADMIN'] {
      background: var(--color-rail);
      color: #fff;
    }
    .pp-role[data-role='MANAGER'] {
      background: var(--color-blue-tint);
      color: var(--color-blue);
    }
    .pp-role[data-role='FOREMAN'] {
      background: var(--color-ok-tint);
      color: var(--color-ok-ink);
    }
    .pp-leads {
      overflow: hidden;
      color: var(--color-text);
      font-size: 0.93rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pp-state {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.93rem;
    }
    .pp-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      background: var(--color-ok);
    }
    .pp-state.is-off {
      color: var(--color-text-muted);
    }
    .pp-state.is-off .pp-dot {
      background: var(--color-line-strong);
    }
    .pp-act {
      justify-self: end;
    }
    .pp-edit {
      padding: 0.25rem 1.1rem 1.1rem 3.95rem;
    }
    .pp-more {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: 1.1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-line);
    }
    .pp-pass-row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.5rem;
    }
    .pp-pass-row .pp-field {
      width: 17rem;
      max-width: 100%;
    }
    .pp-empty {
      padding: 1.25rem 1.1rem;
      color: var(--color-text-muted);
    }
    .pp-note {
      margin-top: 0.75rem;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }

    /* Phones and narrow tablets: each account becomes a stacked card. */
    @media (max-width: 860px) {
      .pp-th {
        display: none;
      }
      .pp-row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'who act'
          'role state'
          'leads leads';
        gap: 0.4rem 0.75rem;
        padding: 0.85rem 1rem;
      }
      .pp-who {
        grid-area: who;
      }
      .pp-act {
        grid-area: act;
      }
      .pp-role {
        grid-area: role;
      }
      .pp-state {
        grid-area: state;
        justify-self: end;
      }
      .pp-leads {
        grid-area: leads;
        white-space: normal;
      }
      .pp-leads:empty {
        display: none;
      }
      .pp-edit {
        padding: 0.25rem 1rem 1rem;
      }
      .pp-cred {
        margin-left: 0;
        margin-right: 0.75rem;
      }
    }
  `,
})
export class PeopleComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ApiClient);
  private readonly store = inject(ManagerStore);
  private readonly network = inject(NetworkStatusService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(SessionStore);

  protected readonly roleOrder = ROLES;
  protected readonly meId = computed(() => this.session.user()?.id ?? null);

  protected readonly state = signal<State>({ kind: 'LOADING' });
  protected readonly filter = signal<RoleFilter>('ALL');
  protected readonly query = signal('');
  protected readonly showInactive = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly creating = signal(false);
  protected readonly fName = signal('');
  protected readonly fUsername = signal('');
  protected readonly fCrew = signal('');
  protected readonly fPassword = signal('');
  protected readonly fRole = signal<Role>('WORKER');
  /** Shown once after an account is created, so the administrator can pass the starting password on. */
  protected readonly handoff = signal<{ readonly name: string; readonly username: string; readonly password: string } | null>(null);

  protected readonly editId = signal<string | null>(null);
  protected readonly eName = signal('');
  protected readonly eCrew = signal('');
  protected readonly eRole = signal<Role>('WORKER');
  protected readonly ePassword = signal('');
  protected readonly confirmOff = signal(false);

  protected readonly ready = computed(() => {
    const s = this.state();
    return s.kind === 'READY' ? s : null;
  });
  protected readonly activeCount = computed(() => (this.ready()?.users ?? []).filter((u) => u.active).length);

  private readonly visible = computed(() => (this.ready()?.users ?? []).filter((u) => this.showInactive() || u.active));

  protected readonly filters = computed(() => {
    const list = this.visible();
    const count = (r: RoleFilter): number => (r === 'ALL' ? list.length : list.filter((u) => u.role === r).length);
    const items: { key: RoleFilter; label: TranslationKey }[] = [
      { key: 'ALL', label: 'people.all' },
      { key: 'ADMIN', label: 'people.filterAdmins' },
      { key: 'MANAGER', label: 'people.filterManagers' },
      { key: 'FOREMAN', label: 'people.filterForemen' },
      { key: 'WORKER', label: 'people.filterWorkers' },
    ];
    return items.map((i) => ({ ...i, count: count(i.key) }));
  });

  protected readonly shown = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLocaleLowerCase();
    return this.visible().filter(
      (u) =>
        (f === 'ALL' || u.role === f) &&
        (!q || `${u.displayName} ${u.username} ${u.crew ?? ''} ${u.projects.map((p) => p.name).join(' ')}`.toLocaleLowerCase().includes(q)),
    );
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    if (this.state().kind !== 'READY') this.state.set({ kind: 'LOADING' });
    try {
      const res = await this.api.adminUsers();
      this.state.set({ kind: 'READY', users: res.users });
    } catch (err: unknown) {
      console.warn('[AON] accounts load failed', err);
      if (this.state().kind !== 'READY') this.state.set({ kind: 'ERROR' });
    }
  }

  protected roleKey(r: Role): TranslationKey {
    return `role.${r}` as TranslationKey;
  }

  protected roleHelpKey(r: Role): TranslationKey {
    return `role.${r}.help` as TranslationKey;
  }

  protected initials(name: string): string {
    return initialsOf(name);
  }

  protected tone(name: string): number {
    return avatarTone(name);
  }

  protected newPassword(): string {
    return startingPassword();
  }

  /** What the account leads: a manager's projects, a foreman's objects; workers and administrators show their open work. */
  protected leads(u: AdminUser): string {
    if (u.role === 'MANAGER') return u.projects.map((p) => p.name).join(', ') || this.i18n.t('people.leadsNone');
    if (u.role === 'FOREMAN') return u.sites.map((s) => s.name).join(', ') || this.i18n.t('people.leadsNone');
    if (u.role === 'ADMIN') return this.i18n.t('people.leadsAll');
    return u.openOrders ? this.i18n.t('people.openOrders', { n: u.openOrders }) : '';
  }

  protected openCreate(): void {
    this.editId.set(null);
    this.handoff.set(null);
    this.fName.set('');
    this.fUsername.set('');
    this.fCrew.set('');
    this.fPassword.set(startingPassword());
    this.fRole.set('WORKER');
    this.formError.set(null);
    this.creating.set(true);
  }

  protected async create(): Promise<void> {
    const displayName = this.fName().trim();
    const username = this.fUsername().trim().toLowerCase();
    const password = this.fPassword();
    if (!displayName || !username) return this.formError.set(this.i18n.t('people.errRequired'));
    if (!USERNAME.test(username)) return this.formError.set(this.i18n.t('people.errUsername'));
    if (password.length < 10) return this.formError.set(this.i18n.t('people.errPassword'));
    await this.write(async () => {
      await this.api.createUser({ username, displayName, role: this.fRole(), crew: this.fCrew().trim() || null, password });
      this.creating.set(false);
      this.handoff.set({ name: displayName, username, password });
      this.toast.success(this.i18n.t('people.created', { name: displayName }));
    });
  }

  protected toggleEdit(u: AdminUser): void {
    if (this.editId() === u.id) {
      this.editId.set(null);
      return;
    }
    this.creating.set(false);
    this.editId.set(u.id);
    this.eName.set(u.displayName);
    this.eCrew.set(u.crew ?? '');
    this.eRole.set(u.role);
    this.ePassword.set('');
    this.confirmOff.set(false);
    this.formError.set(null);
  }

  protected async saveEdit(u: AdminUser): Promise<void> {
    const displayName = this.eName().trim();
    if (!displayName) return this.formError.set(this.i18n.t('people.errRequired'));
    await this.write(async () => {
      await this.api.updateUser(u.id, {
        displayName,
        crew: this.eCrew().trim() || null,
        ...(this.eRole() !== u.role ? { role: this.eRole() } : {}),
      });
      this.editId.set(null);
      this.toast.success(this.i18n.t('projects.saved'));
    });
  }

  protected async resetPassword(u: AdminUser): Promise<void> {
    const password = this.ePassword();
    if (password.length < 10) return this.formError.set(this.i18n.t('people.errPassword'));
    await this.write(async () => {
      await this.api.resetPassword(u.id, { password });
      this.handoff.set({ name: u.displayName, username: u.username, password });
      this.ePassword.set('');
      this.toast.success(this.i18n.t('people.passwordSet'));
    }, false);
  }

  /** Deactivating asks twice; the account keeps its records and can be reactivated. */
  protected async setActive(u: AdminUser, active: boolean): Promise<void> {
    if (!active && !this.confirmOff()) {
      this.confirmOff.set(true);
      return;
    }
    await this.write(async () => {
      await this.api.updateUser(u.id, { active });
      this.editId.set(null);
      this.toast.success(this.i18n.t(active ? 'people.activated' : 'people.deactivated', { name: u.displayName }));
    });
  }

  private async write(action: () => Promise<void>, reload = true): Promise<void> {
    if (this.saving()) return;
    if (!this.network.online()) {
      this.formError.set(this.i18n.t('projects.errOffline'));
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    try {
      await action();
      if (reload) {
        await this.load();
        // Directory (crew picker) and projects (who leads what) depend on accounts.
        void this.store.loadDirectory();
      }
    } catch (err: unknown) {
      console.warn('[AON] account write failed', err);
      const key = err instanceof ApiError ? ERROR_KEYS[err.message] : undefined;
      this.formError.set(this.i18n.t(key ?? 'projects.errFailed'));
    } finally {
      this.saving.set(false);
    }
  }
}
