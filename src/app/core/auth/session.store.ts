import { Injectable, computed, signal } from '@angular/core';
import type { User } from '../models/domain.models';

export interface ActiveSession {
  readonly user: User;
  readonly token: string;
  readonly expiresAt: number;
}

/** In-memory view of the current session. Persisted copy lives in Dexie (`session` table). */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  readonly session = signal<ActiveSession | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly role = computed(() => this.session()?.user.role ?? null);
  /** Set when the server rejects the token: the user must log in again before sync resumes. */
  readonly expired = signal(false);
}
