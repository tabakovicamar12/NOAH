import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from '../db/database.service';
import { CONSENT_VERSION } from '../models/domain.models';
import { SyncEngine } from '../sync/sync-engine.service';
import { uuid } from '../util/util';

/** GDPR consent per user and notice version. Stored on the device and synced to the server. */
@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly db = inject(DatabaseService).db;
  private readonly sync = inject(SyncEngine);

  /** Ticked on the login form; the modal still appears on first login to present the full notice. */
  readonly preAccepted = signal(false);

  async hasConsent(userId: string): Promise<boolean> {
    try {
      const record = await this.db.consents.get(userId);
      return record?.version === CONSENT_VERSION;
    } catch {
      return false;
    }
  }

  async accept(userId: string): Promise<void> {
    const acceptedAt = Date.now();
    const opId = uuid();
    await this.db.transaction('rw', [this.db.consents, this.db.syncQueue], async () => {
      await this.db.consents.put({ userId, version: CONSENT_VERSION, acceptedAt });
      await this.db.syncQueue.add({
        opId,
        userId,
        entityKey: `consent:${userId}`,
        op: { type: 'CONSENT', payload: { version: CONSENT_VERSION, acceptedAt } },
        createdAt: acceptedAt,
        attempts: 0,
        state: 'PENDING',
        lastError: null,
        nextAttemptAt: 0,
      });
    });
    this.sync.nudge();
  }
}
