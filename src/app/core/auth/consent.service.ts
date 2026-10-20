import { Injectable, inject } from '@angular/core';
import { DatabaseService } from '../db/database.service';
import { CONSENT_VERSION } from '../models/domain.models';
import { SyncEngine } from '../sync/sync-engine.service';
import { uuid } from '../util/util';

/**
 * Acknowledgement of the privacy notice, once per account and notice version. Stored on the device and on the
 * server; a login on another device takes the server's record over (AuthService), so it is not asked again.
 */
@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly db = inject(DatabaseService).db;
  private readonly sync = inject(SyncEngine);

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
