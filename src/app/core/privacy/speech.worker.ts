/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { SpeechWorkerRequest, SpeechWorkerResponse } from './speech-worker.messages';

/**
 * On-device speech to text: a Slovenian fine-tune of Whisper base, served with the app (public/models) and run
 * with ONNX Runtime's WebAssembly build (public/ort). Audio never leaves the phone and nothing is fetched from
 * a third party. The model files land in the browser's cache after the first download.
 */

const MODEL = 'whisper-base-sl';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = true;
const wasm = env.backends.onnx.wasm;
if (wasm) wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.mjs', wasm: '/ort/ort-wasm-simd-threaded.wasm' };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (asr) return asr;
  // Bytes per file, so the bar moves with the two large files rather than jumping per file.
  const files = new Map<string, { loaded: number; total: number }>();
  asr = pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'progress', percent: Math.min(99, Math.floor((loaded / total) * 100)) });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => (asr = null));
  return asr;
}

function post(message: SpeechWorkerResponse): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<SpeechWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'load') {
    load().then(
      () => post({ type: 'ready' }),
      (err: unknown) => post({ type: 'load-failed', message: String(err) }),
    );
    return;
  }
  load()
    .then((run) =>
      run(msg.audio, {
        language: msg.lang === 'sl' ? 'slovenian' : 'english',
        task: 'transcribe',
        // Recordings longer than Whisper's 30 s window are cut with overlap and stitched back together.
        chunk_length_s: 30,
        stride_length_s: 5,
      }),
    )
    .then(
      (out) => post({ type: 'result', id: msg.id, text: (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim() }),
      (err: unknown) => post({ type: 'error', id: msg.id, message: String(err) }),
    );
});
