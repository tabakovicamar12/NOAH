import { Injectable, signal } from '@angular/core';
import { AonDatabase } from './aon-db';
import { errorMessage } from '../util/util';

export type StorageState = 'OPENING' | 'READY' | 'UNAVAILABLE';

/**
 * Owns the device database. Opened once at bootstrap; if IndexedDB is blocked (private mode,
 * storage disabled, quota) the app renders a dedicated fallback instead of failing at random later.
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  readonly db = new AonDatabase();
  readonly state = signal<StorageState>('OPENING');
  readonly failure = signal<string | null>(null);

  async open(): Promise<void> {
    try {
      if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is not available in this browser');
      }
      await this.db.open();
      await this.requestPersistence();
      this.state.set('READY');
    } catch (err: unknown) {
      this.failure.set(errorMessage(err));
      this.state.set('UNAVAILABLE');
    }
  }

  /** Ask the browser not to evict offline data under storage pressure. Best effort. */
  private async requestPersistence(): Promise<void> {
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        const persisted = await navigator.storage.persisted();
        if (!persisted) await navigator.storage.persist();
      }
    } catch {
      /* not supported: data is still stored, just evictable */
    }
  }
}
