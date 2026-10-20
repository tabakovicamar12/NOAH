/** Messages between SpeechService and the on-device speech worker. */
export type SpeechWorkerRequest =
  | { readonly type: 'load' }
  | { readonly type: 'transcribe'; readonly id: number; readonly audio: Float32Array; readonly lang: 'sl' | 'en' };

export type SpeechWorkerResponse =
  | { readonly type: 'progress'; readonly percent: number }
  | { readonly type: 'ready' }
  | { readonly type: 'load-failed'; readonly message: string }
  | { readonly type: 'result'; readonly id: number; readonly text: string }
  | { readonly type: 'error'; readonly id: number; readonly message: string };
