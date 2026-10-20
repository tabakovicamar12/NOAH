import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Observable, distinctUntilChanged, filter, firstValueFrom, map, pairwise, startWith, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';

const SIMULATE_KEY = 'aon.simulateOffline';
/** How often the server is tried again after a failed request, while the phone still reports a network. */
const UNREACHABLE_PROBE_MS = 3_000;

/**
 * Single source of truth for connectivity. "Online" means all three hold:
 * the browser reports a network, the server actually answers, and offline simulation is off.
 * navigator.onLine alone lies on site Wi-Fi with no uplink, so reachability is learned from real traffic.
 */
@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  private readonly destroyRef = inject(DestroyRef);
  /** Raw client that bypasses interceptors, so the heartbeat never loops through itself. */
  private readonly rawHttp = new HttpClient(inject(HttpBackend));

  readonly browserOnline = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly serverReachable = signal<boolean>(true);
  readonly simulatedOffline = signal<boolean>(this.readSimulated());

  readonly online = computed(() => this.browserOnline() && this.serverReachable() && !this.simulatedOffline());

  /** Emits once each time the app goes from offline to online. */
  readonly reconnected$: Observable<void> = toObservable(this.online).pipe(
    startWith(this.online()),
    distinctUntilChanged(),
    pairwise(),
    filter(([prev, next]) => !prev && next),
    map(() => undefined),
  );

  private heartbeatHandle: ReturnType<typeof setTimeout> | null = null;
  private probing = false;

  constructor() {
    const onOnline = (): void => {
      this.browserOnline.set(true);
      void this.probe();
    };
    const onOffline = (): void => this.browserOnline.set(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // While the server is unreachable the heartbeat runs every few seconds, so a returning signal is noticed
    // at once; while all is well it stays slow to spare battery and data.
    const beat = (): void => {
      const delay = this.serverReachable() ? environment.heartbeatMs : UNREACHABLE_PROBE_MS;
      this.heartbeatHandle = setTimeout(async () => {
        if (this.browserOnline() && !this.simulatedOffline()) await this.probe();
        beat();
      }, delay);
    };
    beat();

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (this.heartbeatHandle) clearTimeout(this.heartbeatHandle);
    });
  }

  /** Called by the HTTP pipeline after every real response. */
  reportReachable(): void {
    if (!this.serverReachable()) this.serverReachable.set(true);
  }

  /** Called by the HTTP pipeline when a request fails at the network level. */
  reportUnreachable(): void {
    if (this.serverReachable()) this.serverReachable.set(false);
  }

  setSimulatedOffline(value: boolean): void {
    this.simulatedOffline.set(value);
    try {
      localStorage.setItem(SIMULATE_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (!value) void this.probe();
  }

  /** Lightweight reachability check against GET /health. Never throws. */
  async probe(): Promise<boolean> {
    if (this.probing) return this.serverReachable();
    if (this.simulatedOffline() || !this.browserOnline()) return false;
    this.probing = true;
    try {
      if (environment.useMockBackend) {
        // The in-browser mock is reachable whenever the device has a network.
        this.serverReachable.set(navigator.onLine);
      } else {
        await firstValueFrom(this.rawHttp.get(`${environment.apiBaseUrl}/health`).pipe(timeout(5_000)));
        this.serverReachable.set(true);
      }
    } catch {
      this.serverReachable.set(false);
    } finally {
      this.probing = false;
    }
    return this.serverReachable();
  }

  private readSimulated(): boolean {
    try {
      return localStorage.getItem(SIMULATE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
