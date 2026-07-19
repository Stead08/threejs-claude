// レンダワーカー。wasm init → SongRenderer をチャンク駆動し、進捗を post、完了で PCM を transfer する。
// 注: '../wasm-pkg/rhythm_wasm.js' は wasm-pack 生成物。typecheck 時点では未生成で解決エラーになるが想定内。

import init, { SongRenderer } from "../wasm-pkg/rhythm_wasm.js";

/** メインスレッド → ワーカーのレンダ要求。 */
export interface RenderRequest {
  midi: Uint8Array;
  sf2: Uint8Array;
  sampleRate: number;
  excludeTrack?: string;
}

/** ワーカー → メインスレッドのメッセージ。 */
export type RenderResponse =
  | { type: "progress"; ratio: number }
  | { type: "done"; sampleRate: number; left: Float32Array; right: Float32Array }
  | { type: "error"; message: string };

// DedicatedWorkerGlobalScope の最小型（DOM lib の Window.postMessage と衝突させないため self を再解釈）。
interface WorkerScope {
  postMessage(message: RenderResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<RenderRequest>) => void): void;
}

const ctx = self as unknown as WorkerScope;

let initialized: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (initialized === null) {
    initialized = (async (): Promise<void> => {
      await init();
    })();
  }
  return initialized;
}

async function handleRequest(req: RenderRequest): Promise<void> {
  await ensureInit();
  const renderer = new SongRenderer(req.midi, req.sf2, req.sampleRate, req.excludeTrack);
  const total: number = renderer.totalFrames();
  // 1 チャンク = sampleRate フレーム = 1 秒。
  const chunkFrames = req.sampleRate;
  let done = false;
  while (!done) {
    done = renderer.renderChunk(chunkFrames);
    const rendered: number = renderer.renderedFrames();
    const ratio = total > 0 ? Math.min(1, rendered / total) : 1;
    ctx.postMessage({ type: "progress", ratio });
  }
  const result = renderer.take();
  const sampleRate: number = result.sampleRate;
  const left: Float32Array = result.left;
  const right: Float32Array = result.right;
  ctx.postMessage({ type: "done", sampleRate, left, right }, [
    left.buffer,
    right.buffer,
  ] as Transferable[]);
}

ctx.addEventListener("message", (e: MessageEvent<RenderRequest>): void => {
  handleRequest(e.data).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: "error", message });
  });
});
