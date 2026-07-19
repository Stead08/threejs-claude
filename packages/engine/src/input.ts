// InputQueue: pointerdown / keydown を audio 時刻へ変換して容量固定リングに積む。
// drain は再利用ビューを返し、フレームループでの割り当てをゼロにする。

import type { AudioClock } from './clock';

/** 入力動詞。M0 はタップ (0) のみ。 */
const VERB_TAP = 0;
/** リング容量（イベント件数）。 */
const RING_CAPACITY = 64;
/** 1 レコードあたりの f64 数（[timeSec, verb]）。 */
const STRIDE = 2;

export interface InputQueueOptions {
  /** タップ即時コールバック（SFX 用）。引数は audio 時刻（秒）。 */
  onTap?: (timeSec: number) => void;
  /** 入力オフセット（ミリ秒）。判定時刻へ加算される。 */
  inputOffsetMs?: number;
}

/**
 * pointerdown / keydown(Space) を監視し、audio 時刻へ変換して積む固定容量リング。
 * drain() は再利用中の Float64Array の subarray を返す（割り当てゼロ）。
 */
export class InputQueue {
  readonly #clock: AudioClock;
  #onTap: ((timeSec: number) => void) | null;
  #inputOffsetSec: number;

  readonly #ring = new Float64Array(RING_CAPACITY * STRIDE);
  readonly #drainBuffer = new Float64Array(RING_CAPACITY * STRIDE);
  /** 次に書き込むイベント位置（0..RING_CAPACITY-1）。 */
  #writeIndex = 0;
  /** 未 drain 件数（最大 RING_CAPACITY）。 */
  #count = 0;

  #target: EventTarget | null = null;
  #keyboardTarget: EventTarget | null = null;
  #pointerHandler: ((e: Event) => void) | null = null;
  #keyHandler: ((e: Event) => void) | null = null;

  constructor(clock: AudioClock, options: InputQueueOptions = {}) {
    this.#clock = clock;
    this.#onTap = options.onTap ?? null;
    this.#inputOffsetSec = (options.inputOffsetMs ?? 0) / 1000;
  }

  /**
   * イベントターゲットへリスナを取り付ける。
   * pointerdown は target に、keydown は keyboardTarget（既定 target）に登録する。
   * canvas はフォーカス不能で keydown が届かないため、ゲーム側は keyboardTarget に
   * window を渡すこと（PC 開発用）。
   */
  attach(target: EventTarget, keyboardTarget: EventTarget = target): void {
    this.detach();
    this.#target = target;
    this.#keyboardTarget = keyboardTarget;
    this.#pointerHandler = (e: Event): void => {
      this.#push(e.timeStamp);
    };
    this.#keyHandler = (e: Event): void => {
      const ke = e as KeyboardEvent;
      // Space のみ受け付け、オートリピートは除外する（PC 開発用）。
      if (ke.code === 'Space' && !ke.repeat) {
        this.#push(ke.timeStamp);
      }
    };
    // pointerdown は passive で購読（preventDefault しない）。
    target.addEventListener('pointerdown', this.#pointerHandler, { passive: true });
    keyboardTarget.addEventListener('keydown', this.#keyHandler);
  }

  /** リスナを取り外す。 */
  detach(): void {
    if (this.#target === null) {
      return;
    }
    if (this.#pointerHandler !== null) {
      this.#target.removeEventListener('pointerdown', this.#pointerHandler);
    }
    if (this.#keyHandler !== null && this.#keyboardTarget !== null) {
      this.#keyboardTarget.removeEventListener('keydown', this.#keyHandler);
    }
    this.#target = null;
    this.#keyboardTarget = null;
    this.#pointerHandler = null;
    this.#keyHandler = null;
  }

  /** 入力オフセットを更新する。 */
  setInputOffsetMs(ms: number): void {
    this.#inputOffsetSec = ms / 1000;
  }

  /** タップコールバックを差し替える。 */
  setOnTap(onTap: ((timeSec: number) => void) | null): void {
    this.#onTap = onTap;
  }

  /**
   * 蓄積された入力を時刻昇順で返す。再利用ビュー（長さ 2 × 件数）で割り当てゼロ。
   * 返り値は次回 drain までに消費すること（内部バッファを上書きする）。
   */
  drain(): Float64Array {
    const n = this.#count;
    let read = (this.#writeIndex - n + RING_CAPACITY) % RING_CAPACITY;
    for (let i = 0; i < n; i++) {
      const src = read * STRIDE;
      const dst = i * STRIDE;
      this.#drainBuffer[dst] = this.#ring[src] ?? 0;
      this.#drainBuffer[dst + 1] = this.#ring[src + 1] ?? 0;
      read = (read + 1) % RING_CAPACITY;
    }
    this.#count = 0;
    return this.#drainBuffer.subarray(0, n * STRIDE);
  }

  #push(perfMs: number): void {
    const timeSec = this.#clock.perfToAudio(perfMs) + this.#inputOffsetSec;
    const base = this.#writeIndex * STRIDE;
    this.#ring[base] = timeSec;
    this.#ring[base + 1] = VERB_TAP;
    this.#writeIndex = (this.#writeIndex + 1) % RING_CAPACITY;
    if (this.#count < RING_CAPACITY) {
      this.#count++;
    }
    // 容量超過時は最古が上書きされ、count は RING_CAPACITY のまま（読み出し開始位置が進む）。
    if (this.#onTap !== null) {
      this.#onTap(timeSec);
    }
  }
}
