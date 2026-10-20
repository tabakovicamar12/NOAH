import { Injectable, NgZone, inject, signal } from '@angular/core';
import { DatabaseService } from '../db/database.service';
import { I18nService } from '../i18n/i18n.service';
import type { SpeechWorkerRequest, SpeechWorkerResponse } from './speech-worker.messages';

export type SpeechFailure = 'UNSUPPORTED' | 'DENIED' | 'NO_SPEECH' | 'MODEL' | 'FAILED';

/**
 * Speech to text on the device itself, on every phone: record, then a Slovenian Whisper model transcribes in a
 * worker. No speech service is involved, so the audio never leaves the phone (the browsers' own recognition
 * would send it to Google or Apple). Free, and it works offline once the model is downloaded.
 */

/** NONE: never downloaded on this device. READY: in the browser's cache (or loaded). */
export type ModelState = 'NONE' | 'DOWNLOADING' | 'READY' | 'FAILED';

/** Download size shown before the first use, in MB (encoder and decoder, 8-bit). */
export const MODEL_SIZE_MB = 100;

/** Long enough for a field note; longer recordings take long to transcribe on a phone. */
const MAX_RECORDING_MS = 90_000;
const MODEL_FLAG = 'speech-model-ready';

/** Only one session runs at a time; the microphone is on exactly while `listening` is true. */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly zone = inject(NgZone);
  private readonly i18n = inject(I18nService);
  private readonly db = inject(DatabaseService).db;

  private recorder: MediaRecorder | null = null;
  private recorderTimer: ReturnType<typeof setTimeout> | null = null;
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (text: string) => void; reject: (err: unknown) => void }>();

  readonly listening = signal(false);
  /** Recording finished, the model is working on it. */
  readonly transcribing = signal(false);
  /** Seconds recorded, for the on-screen counter. */
  readonly seconds = signal(0);
  readonly modelState = signal<ModelState>('NONE');
  readonly modelPercent = signal(0);

  readonly supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof Worker !== 'undefined';


  constructor() {
    // Downloaded before on this device: warm the model in the background so the first tap is quick.
    void this.db.kv
      .get(MODEL_FLAG)
      .then((row) => {
        if (row?.value === true) {
          this.modelState.set('READY');
          if (this.supported) void this.prepare();
        }
      })
      .catch(() => undefined);
  }

  /** Downloads (first time) or loads from the browser's cache. Safe to call repeatedly. */
  prepare(): Promise<void> {
    if (this.loading) return this.loading;
    const worker = this.ensureWorker();
    if (this.modelState() !== 'READY') this.modelState.set('DOWNLOADING');
    this.loading = new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent<SpeechWorkerResponse>): void => {
        const msg = e.data;
        if (msg.type === 'progress') this.zone.run(() => this.modelPercent.set(msg.percent));
        if (msg.type === 'ready' || msg.type === 'load-failed') {
          worker.removeEventListener('message', onMessage);
          this.zone.run(() => {
            if (msg.type === 'ready') {
              this.modelState.set('READY');
              this.modelPercent.set(100);
              void this.db.kv.put({ key: MODEL_FLAG, value: true }).catch(() => undefined);
              resolve();
            } else {
              console.warn('[AON] speech model failed to load', msg.message);
              this.modelState.set('FAILED');
              this.loading = null;
              reject('MODEL' satisfies SpeechFailure);
            }
          });
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'load' } satisfies SpeechWorkerRequest);
    });
    return this.loading;
  }

  /** Records until `stop()`, then hands the recording's text to `onFinal`. Rejects with a SpeechFailure. */
  async listen(onFinal: (text: string) => void): Promise<void> {
    this.stop();
    if (!this.supported) throw 'UNSUPPORTED' satisfies SpeechFailure;
    return this.recordAndTranscribe(onFinal);
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./speech.worker', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<SpeechWorkerResponse>) => {
      const msg = e.data;
      if (msg.type !== 'result' && msg.type !== 'error') return;
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      this.zone.run(() => (msg.type === 'result' ? job.resolve(msg.text) : job.reject(msg.message)));
    });
    this.worker = worker;
    return worker;
  }

  private async recordAndTranscribe(onFinal: (text: string) => void): Promise<void> {
    // The model loads while the worker speaks; a failed download surfaces after the recording.
    const ready = this.prepare();
    ready.catch(() => undefined);
    const audio = await this.record();
    if (audio.size < 2_000) throw 'NO_SPEECH' satisfies SpeechFailure;
    this.transcribing.set(true);
    try {
      const samples = await decodeTo16k(audio);
      if (samples.length < 16_000 * 0.4) throw 'NO_SPEECH' satisfies SpeechFailure;
      await ready;
      const text = await this.runModel(samples);
      if (!text) throw 'NO_SPEECH' satisfies SpeechFailure;
      onFinal(text);
    } catch (err: unknown) {
      if (typeof err === 'string' && isFailure(err)) throw err;
      console.warn('[AON] on-device transcription failed', err);
      throw 'FAILED' satisfies SpeechFailure;
    } finally {
      this.transcribing.set(false);
    }
  }

  private runModel(audio: Float32Array): Promise<string> {
    const worker = this.ensureWorker();
    const id = ++this.nextId;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'transcribe', id, audio, lang: this.lang() } satisfies SpeechWorkerRequest, [audio.buffer]);
    });
  }

  private async record(): Promise<Blob> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err: unknown) {
      const name = (err as { name?: string } | null)?.name;
      throw (name === 'NotAllowedError' || name === 'SecurityError' ? 'DENIED' : 'FAILED') satisfies SpeechFailure;
    }
    return new Promise<Blob>((resolve, reject) => {
      const type = recordingType();
      let rec: MediaRecorder;
      try {
        rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        reject('FAILED' satisfies SpeechFailure);
        return;
      }
      const chunks: Blob[] = [];
      const started = Date.now();
      const tick = setInterval(() => this.zone.run(() => this.seconds.set(Math.floor((Date.now() - started) / 1000))), 250);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () =>
        this.zone.run(() => {
          clearInterval(tick);
          if (this.recorderTimer) clearTimeout(this.recorderTimer);
          this.recorderTimer = null;
          // The microphone indicator goes off the moment the worker stops, not after the transcription.
          stream.getTracks().forEach((t) => t.stop());
          this.recorder = null;
          this.listening.set(false);
          this.seconds.set(0);
          resolve(new Blob(chunks, { type: (rec.mimeType || type || 'audio/mp4').split(';')[0] }));
        });
      rec.onerror = () => rec.state !== 'inactive' && rec.stop();
      this.recorder = rec;
      this.listening.set(true);
      // iOS delivers data only on stop when no timeslice is given; one second keeps memory steady either way.
      rec.start(1000);
      this.recorderTimer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
    });
  }

  private lang(): 'sl' | 'en' {
    return this.i18n.lang() === 'sl' ? 'sl' : 'en';
  }
}

function isFailure(value: string): value is SpeechFailure {
  return ['UNSUPPORTED', 'DENIED', 'NO_SPEECH', 'MODEL', 'FAILED'].includes(value);
}

/** Opus in WebM where available (Chrome, Firefox); AAC in MP4 on Safari. The browser decodes both. */
function recordingType(): string | null {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/** Whisper takes 16 kHz mono samples. The browser's own decoder resamples while it decodes. */
async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw 'UNSUPPORTED' satisfies SpeechFailure;
  const ctx = new Ctx({ sampleRate: 16_000 });
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    const a = buffer.getChannelData(0);
    const b = buffer.getChannelData(1);
    const mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = ((a[i] ?? 0) + (b[i] ?? 0)) / 2;
    return mono;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
