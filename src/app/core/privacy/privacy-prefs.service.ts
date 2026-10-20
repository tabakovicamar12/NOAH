import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SessionStore } from '../auth/session.store';
import { DatabaseService } from '../db/database.service';

/**
 * Per-user privacy choices that gate device sensors: the camera notice is shown once before the first photo
 * (information, not consent). Kept on the device.
 */
@Injectable({ providedIn: 'root' })
export class PrivacyPrefsService {
  private readonly db = inject(DatabaseService).db;
  private readonly session = inject(SessionStore);

  private readonly uid = computed(() => this.session.user()?.id ?? null);
  readonly cameraNoticeSeen = signal(false);
  readonly loaded = signal(false);

  constructor() {
    effect(() => {
      const uid = this.uid();
      this.loaded.set(false);
      if (uid) void this.load(uid);
    });
  }

  /** Marks the camera notice as read. Returns at once; the write finishes in the background. */
  acknowledgeCamera(): void {
    const uid = this.uid();
    this.cameraNoticeSeen.set(true);
    if (uid) void this.db.kv.put({ key: `camera-notice:${uid}`, value: Date.now() }).catch(() => undefined);
  }

  private async load(uid: string): Promise<void> {
    try {
      const camera = await this.db.kv.get(`camera-notice:${uid}`);
      this.cameraNoticeSeen.set(typeof camera?.value === 'number');
    } catch {
      this.cameraNoticeSeen.set(false);
    } finally {
      this.loaded.set(true);
    }
  }
}
