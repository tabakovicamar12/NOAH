import { type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { catchError, from, of, switchMap, type Observable } from 'rxjs';

/**
 * Reactive Dexie query as a signal. Re-runs whenever the tables it reads change (in any tab),
 * and whenever `key` changes. Errors fall back to `initial` rather than breaking the view.
 * Must be called in an injection context.
 */
export function liveSignal<K, T>(key: Signal<K>, query: (key: K) => Promise<T>, initial: T): Signal<T> {
  const stream: Observable<T> = toObservable(key).pipe(
    switchMap((k) =>
      (from(liveQuery(() => query(k))) as Observable<T>).pipe(
        catchError((err: unknown) => {
          console.error('[AON] live query failed', err);
          return of(initial);
        }),
      ),
    ),
  );
  return toSignal(stream, { initialValue: initial });
}
