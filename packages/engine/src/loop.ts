// GameLoop: requestAnimationFrame 駆動のフレームループ。fps / tickMs を EMA 計測する。
// rAF/caf/now は注入式（既定は globalThis）。metrics オブジェクトは再利用する。

/** フレームメトリクス。オブジェクトは再利用される（毎フレーム同一参照）。 */
export interface LoopMetrics {
  fps: number;
  tickMs: number;
}

export interface GameLoopOptions {
  /** requestAnimationFrame 相当。既定は globalThis.requestAnimationFrame。 */
  raf?: (cb: (t: number) => void) => number;
  /** cancelAnimationFrame 相当。既定は globalThis.cancelAnimationFrame。 */
  caf?: (handle: number) => void;
  /** tickMs 計測用の時刻ソース（ミリ秒）。既定は performance.now。 */
  now?: () => number;
}

const EMA_ALPHA = 0.1;

/** rAF 駆動のゲームループ。 */
export class GameLoop {
  readonly #raf: (cb: (t: number) => void) => number;
  readonly #caf: (handle: number) => void;
  readonly #now: () => number;

  readonly #metrics: LoopMetrics = { fps: 0, tickMs: 0 };
  readonly #frame: (t: number) => void;

  #cb: ((nowSec: number) => void) | null = null;
  #handle = 0;
  #running = false;
  #firstFrame = true;
  #prevFrameMs = 0;
  #fpsInited = false;
  #tickInited = false;

  constructor(options: GameLoopOptions = {}) {
    this.#raf = options.raf ?? ((cb) => requestAnimationFrame(cb));
    this.#caf = options.caf ?? ((handle) => cancelAnimationFrame(handle));
    this.#now = options.now ?? (() => performance.now());
    // フレームコールバックは再利用（毎フレーム新規関数を作らない）。
    this.#frame = (t: number): void => {
      this.#tick(t);
    };
  }

  /** 現在のメトリクス（同一参照を返す）。 */
  get metrics(): LoopMetrics {
    return this.#metrics;
  }

  /** ループ開始。cb には rAF 時刻（秒）を渡す。 */
  start(cb: (nowSec: number) => void): void {
    if (this.#running) {
      this.stop();
    }
    this.#cb = cb;
    this.#running = true;
    this.#firstFrame = true;
    this.#prevFrameMs = 0;
    this.#fpsInited = false;
    this.#tickInited = false;
    this.#metrics.fps = 0;
    this.#metrics.tickMs = 0;
    this.#handle = this.#raf(this.#frame);
  }

  /** ループ停止。 */
  stop(): void {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#caf(this.#handle);
    this.#cb = null;
  }

  #tick(t: number): void {
    if (!this.#running) {
      return;
    }
    // fps 計測（前フレームとの差分から）。
    if (!this.#firstFrame) {
      const dt = t - this.#prevFrameMs;
      if (dt > 0) {
        const instFps = 1000 / dt;
        this.#metrics.fps = this.#fpsInited
          ? this.#metrics.fps * (1 - EMA_ALPHA) + instFps * EMA_ALPHA
          : instFps;
        this.#fpsInited = true;
      }
    }
    this.#firstFrame = false;
    this.#prevFrameMs = t;

    // cb 実行時間を計測。
    const start = this.#now();
    const cb = this.#cb;
    if (cb !== null) {
      cb(t / 1000);
    }
    const elapsed = this.#now() - start;
    this.#metrics.tickMs = this.#tickInited
      ? this.#metrics.tickMs * (1 - EMA_ALPHA) + elapsed * EMA_ALPHA
      : elapsed;
    this.#tickInited = true;

    if (this.#running) {
      this.#handle = this.#raf(this.#frame);
    }
  }
}
