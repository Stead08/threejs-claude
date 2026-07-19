// RenderClient: render.worker を駆動して曲 PCM をオフラインレンダする。

import type { RenderRequest, RenderResponse } from './render.worker';

export interface RenderSongOptions {
  midi: Uint8Array;
  sf2: Uint8Array;
  sampleRate: number;
  excludeTrack?: string;
}

export interface RenderedSong {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

/** ワーカーで曲をレンダするクライアント。 */
export class RenderClient {
  /**
   * 曲をレンダする。onProgress には 0..1 の進捗が渡る。
   * 完了で { sampleRate, left, right } を解決する（PCM はワーカーから transfer される）。
   */
  renderSong(
    options: RenderSongOptions,
    onProgress?: (ratio: number) => void,
  ): Promise<RenderedSong> {
    return new Promise<RenderedSong>((resolve, reject) => {
      const worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
        type: 'module',
      });
      const cleanup = (): void => {
        worker.terminate();
      };
      worker.onmessage = (e: MessageEvent<RenderResponse>): void => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            onProgress?.(msg.ratio);
            break;
          case 'done':
            resolve({ sampleRate: msg.sampleRate, left: msg.left, right: msg.right });
            cleanup();
            break;
          case 'error':
            reject(new Error(msg.message));
            cleanup();
            break;
        }
      };
      worker.onerror = (e: ErrorEvent): void => {
        reject(new Error(e.message || 'render worker error'));
        cleanup();
      };
      const request: RenderRequest = {
        midi: options.midi,
        sf2: options.sf2,
        sampleRate: options.sampleRate,
        excludeTrack: options.excludeTrack,
      };
      worker.postMessage(request);
    });
  }
}
