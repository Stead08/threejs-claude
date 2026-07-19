// AudioClock: performance 時刻 ⇄ audio 時刻の対応を平滑化して提供する。
// 時刻ソースは注入式 (ClockSources) にして純テスト可能にしている。

/** 時刻ソース抽象。実ブラウザでは AudioContext / performance から供給する。 */
export interface ClockSources {
  /** performance.now() 相当（ミリ秒）。 */
  perfNowMs(): number;
  /** AudioContext.currentTime 相当（秒）。 */
  audioCurrentTimeSec(): number;
  /**
   * getOutputTimestamp() 相当。API 不在時は null。
   * contextTime = audio 時刻(秒), performanceTime = performance 時刻(ミリ秒)。
   */
  outputTimestamp(): { contextTime: number; performanceTime: number } | null;
}

const EMA_ALPHA = 0.1;
const UPDATE_INTERVAL_SEC = 1.0;

/**
 * マスタークロック。offset (= contextTime - performanceTime/1000) を EMA で平滑化し、
 * perfToAudio(perfMs) = perfMs/1000 + offset を返す。
 * getOutputTimestamp が不在/0 値ペアなら currentTime - perfNow/1000 でフォールバック。
 */
export class AudioClock {
  readonly #sources: ClockSources;
  #offset = 0;
  #hasOffset = false;
  #lastUpdateSec = Number.NEGATIVE_INFINITY;

  constructor(sources: ClockSources) {
    this.#sources = sources;
    // 初回 offset を確立する。
    this.#refresh(this.#sources.audioCurrentTimeSec());
  }

  /** 現在の audio 時刻（秒）。 */
  now(): number {
    return this.#sources.audioCurrentTimeSec();
  }

  /** 現在の平滑化済み offset（秒）。テスト・デバッグ用。 */
  get offset(): number {
    return this.#offset;
  }

  /** performance 時刻（ミリ秒）を audio 時刻（秒）へ変換する。毎秒 offset を更新する。 */
  perfToAudio(perfMs: number): number {
    const nowSec = this.#sources.audioCurrentTimeSec();
    if (nowSec - this.#lastUpdateSec >= UPDATE_INTERVAL_SEC) {
      this.#refresh(nowSec);
    }
    return perfMs / 1000 + this.#offset;
  }

  #refresh(nowSec: number): void {
    this.#lastUpdateSec = nowSec;
    const ts = this.#sources.outputTimestamp();
    if (ts !== null && ts.contextTime > 0 && ts.performanceTime > 0) {
      const sample = ts.contextTime - ts.performanceTime / 1000;
      if (this.#hasOffset) {
        this.#offset = (1 - EMA_ALPHA) * this.#offset + EMA_ALPHA * sample;
      } else {
        this.#offset = sample;
        this.#hasOffset = true;
      }
    } else {
      // API 不在/0 値ペアはフォールバック（EMA せず直接採用）。
      this.#offset = nowSec - this.#sources.perfNowMs() / 1000;
      this.#hasOffset = true;
    }
  }
}

/** 実ブラウザ用ファクトリ。AudioContext から ClockSources を組み立てる。 */
export function fromAudioContext(ctx: AudioContext): AudioClock {
  const sources: ClockSources = {
    perfNowMs: () => performance.now(),
    audioCurrentTimeSec: () => ctx.currentTime,
    outputTimestamp: () => {
      if (typeof ctx.getOutputTimestamp !== 'function') {
        return null;
      }
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime === undefined || ts.performanceTime === undefined) {
        return null;
      }
      return { contextTime: ts.contextTime, performanceTime: ts.performanceTime };
    },
  };
  return new AudioClock(sources);
}
