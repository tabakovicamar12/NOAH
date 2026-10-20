import { Injectable, computed, inject, signal } from '@angular/core';
import { DatabaseService } from '../db/database.service';
import { ApiClient } from '../http/api-client.service';
import type { OrgInfo } from '../models/api.models';
import { NetworkStatusService } from '../network/network-status.service';

const CACHE_KEY = 'org-info';

/**
 * The employer that runs this installation (the data controller), as the server is configured. Named in the
 * privacy notice and at the head of printed reports. Cached on the device so both still work offline.
 */
@Injectable({ providedIn: 'root' })
export class OrgService {
  private readonly db = inject(DatabaseService).db;
  private readonly api = inject(ApiClient);
  private readonly network = inject(NetworkStatusService);

  readonly info = signal<OrgInfo | null>(null);
  readonly name = computed(() => this.info()?.name ?? null);
  /** True once the employer's details are configured; until then the notice is marked as a draft. */
  readonly configured = computed(() => !!this.info()?.name);

  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= this.fetch().finally(() => (this.loading = null));
    return this.loading;
  }

  private async fetch(): Promise<void> {
    try {
      const cached = (await this.db.kv.get(CACHE_KEY))?.value as OrgInfo | undefined;
      if (cached && typeof cached === 'object') this.info.set(cached);
    } catch {
      /* no cache: fine */
    }
    if (!this.network.online()) return;
    try {
      const fresh = await this.api.org();
      this.info.set(fresh);
      await this.db.kv.put({ key: CACHE_KEY, value: fresh });
    } catch (err: unknown) {
      console.warn('[AON] organisation details unavailable', err);
    }
  }
}
