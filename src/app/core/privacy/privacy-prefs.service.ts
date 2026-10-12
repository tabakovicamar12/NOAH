import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SessionStore } from '../auth/session.store';
import { DatabaseService } from '../db/database.service';
import { VOICE_CONSENT_VERSION } from '../models/domain.models';
import { SyncEngine } from '../sync/sync-engine.service';
import { queueItem } from '../sync/sync-queue';

interface VoiceConsent {
  readonly version: string;
  readonly at: number;
}

/**
 * Per-user privacy choices that gate device sensors:
 * - voice input needs explicit, withdrawable consent (the browser vendor processes the audio);
 * - the camera notice is shown once before the first photo (information, not consent).
 * Kept on the device; consent and withdrawal are also recorded on the server through the sync queue.
 */
@Injectable({ providedIn: 'root' })
export class PrivacyPrefsService {
  private readonly db = inject(DatabaseService).db;
  private readonly session = inject(SessionStore);
  private readonly sync = inject(SyncEngine);

  private readonly uid = computed(() => this.session.user()?.id ?? null);
  readonly voiceConsent = signal<VoiceConsent | null>(null);
  readonly cameraNoticeSeen = signal(false);
  readonly loaded = signal(false);

  constructor() {
    effect(() => {
      const uid = this.uid();
      this.loaded.set(false);
      if (uid) void this.load(uid);
    });
  }

  readonly hasVoiceConsent = computed(() => this.voiceConsent()?.version === VOICE_CONSENT_VERSION);

  async grantVoice(): Promise<void> {
    await this.recordVoice(VOICE_CONSENT_VERSION);
  }

  async withdrawVoice(): Promise<void> {
    await this.recordVoice(`${VOICE_CONSENT_VERSION}:withdrawn`);
  }

  /** Marks the camera notice as read. Returns at once; the write finishes in the background. */
  acknowledgeCamera(): void {
    const uid = this.uid();
    this.cameraNoticeSeen.set(true);
    if (uid) void this.db.kv.put({ key: `camera-notice:${uid}`, value: Date.now() }).catch(() => undefined);
  }

  private async recordVoice(version: string): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    const at = Date.now();
    const granted = !version.endsWith(':withdrawn');
    await this.db.transaction('rw', [this.db.kv, this.db.syncQueue], async () => {
      if (granted) await this.db.kv.put({ key: `voice-consent:${uid}`, value: { version, at } satisfies VoiceConsent });
      else await this.db.kv.delete(`voice-consent:${uid}`);
      await this.db.syncQueue.add(queueItem(uid, `consent:${uid}:voice`, { type: 'CONSENT', payload: { version, acceptedAt: at } }));
    });
    this.voiceConsent.set(granted ? { version, at } : null);
    this.sync.nudge();
  }

  private async load(uid: string): Promise<void> {
    try {
      const [voice, camera] = await Promise.all([this.db.kv.get(`voice-consent:${uid}`), this.db.kv.get(`camera-notice:${uid}`)]);
      const v = voice?.value as Partial<VoiceConsent> | undefined;
      this.voiceConsent.set(v && typeof v.version === 'string' && typeof v.at === 'number' ? { version: v.version, at: v.at } : null);
      this.cameraNoticeSeen.set(typeof camera?.value === 'number');
    } catch {
      this.voiceConsent.set(null);
      this.cameraNoticeSeen.set(false);
    } finally {
      this.loaded.set(true);
    }
  }
}
