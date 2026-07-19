// デバッグ HUD 用の判定統計アキュムレータ。
// tick() が返す Judged/AutoMiss イベントのストリームから、crates/core の Stats と同じ規則
// （誤差統計は Just/Safe のみ、Miss は件数のみ）で mean/std（Welford 法）とヒストグラムを追跡する。
// 割り当てゼロ（Uint32Array を再利用）。

/** ヒストグラムのビン数（-100..100ms を 10ms 刻み）。crates/core の Stats.histogram と同じ規則。 */
const HISTOGRAM_BINS = 20;
const HISTOGRAM_FROM_MS = -100;
const HISTOGRAM_BIN_MS = 10;

export class JudgeStatsAccumulator {
  #just = 0;
  #safe = 0;
  #miss = 0;
  #errorCount = 0;
  #mean = 0;
  #m2 = 0;

  /** 誤差ヒストグラム（20 ビン、再利用される TypedArray）。 */
  readonly histogram = new Uint32Array(HISTOGRAM_BINS);

  get just(): number {
    return this.#just;
  }

  get safe(): number {
    return this.#safe;
  }

  get miss(): number {
    return this.#miss;
  }

  get meanMs(): number {
    return this.#mean;
  }

  get stdMs(): number {
    return this.#errorCount > 0 ? Math.sqrt(this.#m2 / this.#errorCount) : 0;
  }

  /** Just 判定を記録する（誤差統計に含める）。 */
  recordJust(errorMs: number): void {
    this.#just++;
    this.#accumulateError(errorMs);
  }

  /** Safe 判定を記録する（誤差統計に含める）。 */
  recordSafe(errorMs: number): void {
    this.#safe++;
    this.#accumulateError(errorMs);
  }

  /** Miss（AutoMiss）を記録する。誤差統計には含めない。 */
  recordMiss(): void {
    this.#miss++;
  }

  #accumulateError(errorMs: number): void {
    this.#errorCount++;
    const delta = errorMs - this.#mean;
    this.#mean += delta / this.#errorCount;
    const delta2 = errorMs - this.#mean;
    this.#m2 += delta * delta2;

    const rawIndex = Math.floor((errorMs - HISTOGRAM_FROM_MS) / HISTOGRAM_BIN_MS);
    const index = Math.min(HISTOGRAM_BINS - 1, Math.max(0, rawIndex));
    this.histogram[index] = (this.histogram[index] ?? 0) + 1;
  }
}
