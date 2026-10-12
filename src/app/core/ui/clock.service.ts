import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** One shared 1 s tick for every running timer on screen. */
@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly now = signal(Date.now());

  constructor() {
    const handle = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(handle));
  }
}
