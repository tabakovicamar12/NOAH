import { Injectable, computed, inject } from '@angular/core';
import { DatabaseService } from '../db/database.service';
import { ApiClient } from '../http/api-client.service';
import { ApiError } from '../models/api.models';
import type { LoginConsents, LoginSide } from '../models/api.models';
import { CONSENT_VERSION, VOICE_CONSENT_VERSION, type User } from '../models/domain.models';
import { NetworkStatusService } from '../network/network-status.service';
import { SessionStore } from './session.store';

export type LoginFailure = 'INVALID' | 'ROLE_MISMATCH' | 'OFFLINE' | 'THROTTLED' | 'UNKNOWN';

export type LoginOutcome = { readonly ok: true; readonly user: User } | { readonly ok: false; readonly reason: LoginFailure };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly db = inject(DatabaseService).db;
  private readonly api = inject(ApiClient);
  private readonly network = inject(NetworkStatusService);
  private readonly store = inject(SessionStore);

  readonly user = this.store.user;
  readonly isLoggedIn = computed(() => this.store.session() !== null);

  /** Restore the persisted session at startup. Works offline: an expired token still unlocks local data. */
  async restore(): Promise<void> {
    try {
      const saved = await this.db.session.get('current');
      if (!saved) return;
      this.store.session.set({ user: saved.user, token: saved.token, expiresAt: saved.expiresAt });
      this.store.expired.set(saved.expiresAt < Date.now());
    } catch (err: unknown) {
      console.error('[AON] session restore failed', err);
    }
  }

  /** The last user on this device, for offline resume. */
  async lastSession(): Promise<User | null> {
    try {
      return (await this.db.session.get('current'))?.user ?? null;
    } catch {
      return null;
    }
  }

  async login(username: string, password: string, role: LoginSide): Promise<LoginOutcome> {
    if (!this.network.online()) return { ok: false, reason: 'OFFLINE' };
    try {
      const res = await this.api.login({ username: username.trim(), password, role });
      await this.db.session.put({ key: 'current', user: res.user, token: res.token, expiresAt: res.expiresAt });
      await this.adoptConsents(res.user.id, res.consents);
      this.store.session.set({ user: res.user, token: res.token, expiresAt: res.expiresAt });
      this.store.expired.set(false);
      return { ok: true, user: res.user };
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.message === 'ROLE_MISMATCH') return { ok: false, reason: 'ROLE_MISMATCH' };
        if (err.status === 429) return { ok: false, reason: 'THROTTLED' };
        if (err.kind === 'UNAUTHORIZED') return { ok: false, reason: 'INVALID' };
        if (err.kind === 'NETWORK' || err.kind === 'TIMEOUT') return { ok: false, reason: 'OFFLINE' };
      }
      console.error('[AON] login failed', err);
      return { ok: false, reason: 'UNKNOWN' };
    }
  }

  /**
   * Takes over what the account acknowledged on another device, so the notice is not shown again.
   * A voice decision still waiting in this device's queue is newer than the server's and wins.
   */
  private async adoptConsents(userId: string, consents: LoginConsents | undefined): Promise<void> {
    if (!consents) return;
    try {
      const pending = await this.db.syncQueue.where('userId').equals(userId).filter((q) => q.op.type === 'CONSENT').toArray();
      const notice = consents.notice;
      if (notice?.version === CONSENT_VERSION && !(await this.db.consents.get(userId))) {
        await this.db.consents.put({ userId, version: notice.version, acceptedAt: notice.acceptedAt });
      }
      const voice = consents.voice;
      if (voice && !pending.some((q) => q.entityKey === `consent:${userId}:voice`)) {
        if (voice.version === VOICE_CONSENT_VERSION) await this.db.kv.put({ key: `voice-consent:${userId}`, value: { version: voice.version, at: voice.acceptedAt } });
        else await this.db.kv.delete(`voice-consent:${userId}`);
      }
    } catch (err: unknown) {
      // Worst case the notice is shown once more.
      console.warn('[AON] could not store consents from the server', err);
    }
  }

  /**
   * Ends the session. Unsynced entries stay in the device queue under this user id and upload
   * after the same user logs in again; nothing is silently dropped.
   */
  async logout(): Promise<void> {
    try {
      await this.db.session.delete('current');
    } catch (err: unknown) {
      console.error('[AON] logout cleanup failed', err);
    }
    this.store.session.set(null);
    this.store.expired.set(false);
  }
}
