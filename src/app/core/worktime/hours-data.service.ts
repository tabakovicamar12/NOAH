import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../http/api-client.service';
import type { HoursResponse } from '../models/api.models';

export type HoursSide = 'manager' | 'worker';

/**
 * Loads a month of working time and keeps the last answer per side and month, so going back to a month or
 * losing the connection still shows the record that was loaded.
 */
@Injectable({ providedIn: 'root' })
export class HoursData {
  private readonly api = inject(ApiClient);
  private readonly cache = new Map<string, { data: HoursResponse; at: number }>();

  cached(side: HoursSide, month: string): { data: HoursResponse; at: number } | null {
    return this.cache.get(`${side}:${month}`) ?? null;
  }

  /** Fresh from the server; on failure the cached copy, marked with when it was loaded. */
  async load(side: HoursSide, month: string): Promise<{ data: HoursResponse; cachedAt: number | null }> {
    const key = `${side}:${month}`;
    try {
      const data = await this.api.hours(side, month);
      this.cache.set(key, { data, at: Date.now() });
      return { data, cachedAt: null };
    } catch (err) {
      const hit = this.cache.get(key);
      if (hit) return { data: hit.data, cachedAt: hit.at };
      throw err;
    }
  }
}
