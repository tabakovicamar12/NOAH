import { Injectable, NgZone, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';

/** Minimal typing for the Web Speech API (not in the DOM lib for every browser). */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type SpeechFailure = 'UNSUPPORTED' | 'DENIED' | 'NO_SPEECH' | 'NETWORK' | 'FAILED';

/**
 * Speech to text through the browser's own recognition (Chrome, Edge, Safari). Only one session runs at a
 * time; the microphone is on exactly while `listening` is true.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly zone = inject(NgZone);
  private readonly i18n = inject(I18nService);
  private active: SpeechRecognitionLike | null = null;

  readonly listening = signal(false);
  /** The words heard so far in the running session, before they are final. */
  readonly interim = signal('');

  readonly supported: boolean = !!this.ctor();

  /**
   * Starts listening. `onFinal` receives each finished phrase; resolves when the session ends, or rejects
   * with a SpeechFailure.
   */
  listen(onFinal: (text: string) => void): Promise<void> {
    const Ctor = this.ctor();
    if (!Ctor) return Promise.reject<void>('UNSUPPORTED' satisfies SpeechFailure);
    this.stop();
    return new Promise<void>((resolve, reject) => {
      const rec = new Ctor();
      rec.lang = this.i18n.lang() === 'sl' ? 'sl-SI' : 'en-GB';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let failure: SpeechFailure | null = null;
      rec.onresult = (e) =>
        this.zone.run(() => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (!r) continue;
            const text = r[0].transcript.trim();
            if (r.isFinal) {
              if (text) onFinal(text);
            } else {
              interim += `${text} `;
            }
          }
          this.interim.set(interim.trim());
        });
      rec.onerror = (e) => {
        failure =
          e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'DENIED'
            : e.error === 'no-speech'
              ? 'NO_SPEECH'
              : e.error === 'network'
                ? 'NETWORK'
                : e.error === 'aborted'
                  ? null
                  : 'FAILED';
      };
      rec.onend = () =>
        this.zone.run(() => {
          if (this.active === rec) this.active = null;
          this.listening.set(false);
          this.interim.set('');
          if (failure) reject(failure);
          else resolve();
        });
      try {
        rec.start();
        this.active = rec;
        this.listening.set(true);
      } catch {
        reject('FAILED' satisfies SpeechFailure);
      }
    });
  }

  stop(): void {
    try {
      this.active?.stop();
    } catch {
      /* already stopped */
    }
  }

  private ctor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }
}
